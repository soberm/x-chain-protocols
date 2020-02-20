pragma solidity ^0.5.13;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "solidity-rlp/contracts/RLPReader.sol";
import "./TxInclusionVerifier.sol";

contract BurnClaimConfirm is ERC20 {
    using RLPReader for RLPReader.RLPItem;
    using RLPReader for bytes;

    struct ClaimData {
        address burnContract;   // the contract which has burnt the tokens on the other blockchian
        address sender;         // sender on the burn token contract
        address recipient;      // recipient on the destination token contract
        address claimContract;   // address of the contract that should process the claim tx
        uint value;             // the value to create on this chain
        bool isBurnValid;       // indicates whether the burning of tokens has taken place (didn't abort, e.g., due to require statement)
        uint burnTime;          // specifies the block number of the block containing the burn tx
    }

    struct ConfirmData {
        address claimContract;  // address of the contract that should have processed the claim tx
        address burnContract;   // address of the contract that should have processed the burn tx
        address sender;         // sender who burnt the tokens
        bool isClaimValid;      // true if claim tx has been successfully executed (e.g., no require statement triggered)
        address stakeRecipient; // client who will receive the stake on the source blockchain when confirm tx is posted after fair confirm period
        uint burnTime;          // specifies the block number of the block containing the burn tx
    }

    TxInclusionVerifier txInclusionVerifier;
    mapping(bytes32 => bool) claimedBurnTransactions;
    mapping(bytes32 => bool) confirmedClaimTransactions;
    uint chainIdentifier;
    mapping(address => bool) participatingTokenContracts;  // addresses of the token contracts living on other blockchains
    uint TRANSFER_FEE = 10;  // 1/10 of the transfer amount
    uint8 constant REQUIRED_TX_CONFIRMATIONS = 10;  // number of blocks that have to follow the block containing a tx to consider it confirmed
    uint constant ETH_IN_WEI = 1000000000000000000;
    uint constant REQUIRED_STAKE_WEI = 1 * ETH_IN_WEI;   // required stake in Wei for burn
    uint constant FAIR_CONFIRM_PERIOD = 40;  // Number of blocks that must follow the block containing the claim tx.
                                             // Posting a confirm tx within this period results in transferring the stake to the burner.
                                             // If the confirm tx is posted after this period, the client submitting the tx receives the stake.

    constructor(address[] memory tokenContracts, address txInclVerifier, uint initialSupply) public {
        for (uint i = 0; i < tokenContracts.length; i++) {
            participatingTokenContracts[tokenContracts[i]] = true;
        }
        txInclusionVerifier = TxInclusionVerifier(txInclVerifier);
        _mint(msg.sender, initialSupply);
    }

    // For simplicity, use this function to register further token contracts.
    // This has obvious security implications as any one is able to change this address -> do not use it in production.
    function registerTokenContract(address tokenContract) public {
        require(tokenContract != address(0), "contract address must not be zero address");
        participatingTokenContracts[tokenContract] = true;
    }

    function burn(address recipient, address claimContract, uint value, uint stakeInWei) public payable {
        require(recipient != address(0), "recipient address must not be zero address");
        require(participatingTokenContracts[claimContract] == true, "claim token contract address is not registered");
        require(msg.value == stakeInWei, 'msg.value does not match function parameter stake');
        require(stakeInWei == REQUIRED_STAKE_WEI, 'provided stake does not match required stake');

        _burn(msg.sender, value);

        emit Burn(msg.sender, recipient, claimContract, value);
        emit BurnTime(block.number);  // determines start of fair claim period
    }

    function claim(
        address stakeRecipient,             // the address to which the stake is assigned to when no CONFIRM tx is posted on the source blockchain within fair confir
        bytes memory rlpHeader,             // rlp-encoded header of the block containing burn tx along with its receipt
        bytes memory rlpEncodedTx,          // rlp-encoded burn tx
        bytes memory rlpEncodedReceipt,     // rlp-encoded receipt of burn tx ('burn receipt)
        bytes memory rlpMerkleProofTx,      // rlp-encoded Merkle proof of Membership for burn tx (later passed to relay)
        bytes memory rlpMerkleProofReceipt, // rlp-encoded Merkle proof of Membership for burn receipt (later passed to relay)
        bytes memory path                   // the path from the root node down to the burn tx/receipt in the corresponding Merkle tries (tx, receipt).
                                            // path is the same for both tx and its receipt.
    ) public payable {

        ClaimData memory c = extractClaim(rlpEncodedTx, rlpEncodedReceipt);
        bytes32 txHash = keccak256(rlpEncodedTx);

        // check pre-conditions
        require(claimedBurnTransactions[txHash] == false, "tokens have already been claimed");
        require(participatingTokenContracts[c.burnContract] == true, "burn contract address is not registered");
        require(c.claimContract == address(this), "this contract has not been specified as destination token contract");
        require(c.isBurnValid == true, "burn transaction was not successful (e.g., require statement was violated)");

        // verify inclusion of burn transaction
        uint txExists = txInclusionVerifier.verifyTransaction(0, rlpHeader, REQUIRED_TX_CONFIRMATIONS, rlpEncodedTx, path, rlpMerkleProofTx);
        require(txExists == 1, "burn transaction does not exist or has not enough confirmations");

        // verify inclusion of receipt
        uint receiptExists = txInclusionVerifier.verifyReceipt(0, rlpHeader, REQUIRED_TX_CONFIRMATIONS, rlpEncodedReceipt, path, rlpMerkleProofReceipt);
        require(receiptExists == 1, "burn receipt does not exist or has not enough confirmations");

        claimedBurnTransactions[txHash] = true; // IMPORTANT: prevent this tx from being used for further claims
        emit Claim(c.burnContract, c.sender, stakeRecipient, c.burnTime);
    }

    function confirm(
        bytes memory rlpHeader,             // rlp-encoded header of the block containing claim tx along with its receipt
        bytes memory rlpEncodedTx,          // rlp-encoded claim tx
        bytes memory rlpEncodedReceipt,     // rlp-encoded receipt of claim tx ('claim receipt')
        bytes memory rlpMerkleProofTx,      // rlp-encoded Merkle proof of Membership for claim tx (later passed to relay)
        bytes memory rlpMerkleProofReceipt, // rlp-encoded Merkle proof of Membership for claim receipt (later passed to relay)
        bytes memory path                   // the path from the root node down to the claim tx/receipt in the corresponding Merkle tries (tx, receipt).
                                            // path is the same for both tx and its receipt.
    ) public {
        ConfirmData memory c = extractConfirm(rlpEncodedTx, rlpEncodedReceipt);
        bytes32 txHash = keccak256(rlpEncodedTx);

        // check pre-conditions
        require(confirmedClaimTransactions[txHash] == false, "claim tx is already confirmed");
        require(participatingTokenContracts[c.claimContract] == true, "claim contract address is not registered");
        require(c.burnContract == address(this), "this contract has not been specified as burn contract");
        require(c.isClaimValid == true, "claim transaction was not successful (e.g., require statement was violated)");

        // verify inclusion of burn transaction
        uint txExists = txInclusionVerifier.verifyTransaction(0, rlpHeader, REQUIRED_TX_CONFIRMATIONS, rlpEncodedTx, path, rlpMerkleProofTx);
        require(txExists == 1, "claim transaction does not exist or has not enough confirmations");

        // verify inclusion of receipt
        uint receiptExists = txInclusionVerifier.verifyReceipt(0, rlpHeader, REQUIRED_TX_CONFIRMATIONS, rlpEncodedReceipt, path, rlpMerkleProofReceipt);
        require(receiptExists == 1, "claim receipt does not exist or has not enough confirmations");

        confirmedClaimTransactions[txHash] = true; // IMPORTANT: prevent this tx from being used for further claims

        address payable stakeRecipientAddr = address(uint160(c.sender));
        if (c.burnTime + FAIR_CONFIRM_PERIOD < block.number) {
            // fair confirm period has already elapsed -> stake goes to stakeRecipient
            stakeRecipientAddr = address(uint160(c.stakeRecipient));
        }
        stakeRecipientAddr.transfer(REQUIRED_STAKE_WEI);

        emit Confirm(txHash);
    }

    function extractClaim(bytes memory rlpTransaction, bytes memory rlpReceipt) private pure returns (ClaimData memory) {
        ClaimData memory c;
        // parse transaction
        RLPReader.RLPItem[] memory transaction = rlpTransaction.toRlpItem().toList();
        c.burnContract = transaction[3].toAddress();

        // parse receipt
        RLPReader.RLPItem[] memory receipt = rlpReceipt.toRlpItem().toList();
        c.isBurnValid = receipt[3].toBoolean();

        // read logs
        RLPReader.RLPItem[] memory logs = receipt[2].toList();
        RLPReader.RLPItem[] memory burnEventTuple = logs[1].toList();  // logs[0] contains the transfer event emitted by the ECR20 method _burn
                                                                       // logs[1] contains the burn event emitted by the method burn (this contract)
        RLPReader.RLPItem[] memory burnEventTopics = burnEventTuple[1].toList();  // topics contain all indexed event fields

        // read value and recipient from burn event
        c.recipient = address(burnEventTopics[1].toUint());  // indices of indexed fields start at 1 (0 is reserved for the hash of the event signature)
        c.claimContract = address(burnEventTopics[2].toUint());
        c.value = burnEventTopics[3].toUint();

        return c;
    }

    function extractConfirm(bytes memory rlpTransaction, bytes memory rlpReceipt) private pure returns (ConfirmData memory) {
        ConfirmData memory c;
        // parse transaction
        RLPReader.RLPItem[] memory transaction = rlpTransaction.toRlpItem().toList();
        c.claimContract = transaction[3].toAddress();

        // parse receipt
        RLPReader.RLPItem[] memory receipt = rlpReceipt.toRlpItem().toList();
        c.isClaimValid = receipt[3].toBoolean();

        // read logs
        RLPReader.RLPItem[] memory logs = receipt[2].toList();
        RLPReader.RLPItem[] memory claimEvent = logs[0].toList();
        RLPReader.RLPItem[] memory claimEventTopics = claimEvent[1].toList();  // topics contain all indexed event fields

        c.burnContract = address(claimEventTopics[1].toUint()); // indices of indexed fields start at 1 (0 is reserved for the hash of the event signature)
        c.sender = address(claimEventTopics[2].toUint());
        c.stakeRecipient = address(claimEventTopics[3].toUint());
        c.burnTime = claimEvent[2].toUint();

        return c;
    }

    /**
     * @dev Divides amount by divisor and returns the integer result. If the remainder is greater than 0,
     *      the result is incremented by 1 (rounded up).
     */
    function calculateFee(uint amount, uint divisor) private pure returns (uint) {
        uint result = amount / divisor;
        uint remainder = amount % divisor;

        if (remainder > 0) {
            // round towards next integer
            return result + 1;
        }
        else {
            return result;
        }
    }

    event Burn(address indexed sender, address indexed recipient, address indexed claimTokenContract, uint value);
    event BurnTime(uint time);
    event Claim(
        address indexed burnContract,
        address indexed sender,
        address indexed stakeRecipient,
        uint burnTime
    );
    event Confirm(bytes32 burnTxHash);
}
