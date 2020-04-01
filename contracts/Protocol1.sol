pragma solidity ^0.5.13;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "solidity-rlp/contracts/RLPReader.sol";
import "./TxInclusionVerifier.sol";

contract Protocol1 is ERC20 {
    using RLPReader for RLPReader.RLPItem;
    using RLPReader for bytes;

    struct ClaimData {
        address burnContract;   // the contract which has burnt the tokens on the other blockchian
        address recipient;
        address claimContract;
        uint value;        // the value to create on this chain
        bool isBurnValid;    // indicates whether the burning of tokens has taken place (didn't abort, e.g., due to require statement)
    }

    TxInclusionVerifier txInclusionVerifier;
    mapping(bytes32 => bool) claimedTransactions;
    uint chainIdentifier;
    mapping(address => bool) participatingTokenContracts;  // addresses of the token contracts living on other blockchains
    uint TRANSFER_FEE = 10;  // 1/10 of the transfer amount
    uint8 constant REQUIRED_TX_CONFIRMATIONS = 10;  // number of blocks that have to follow the block containing a tx to consider it confirmed
    uint constant FAIR_CLAIM_PERIOD = 20;  // Number of blocks that must follow the block containing the burn tx.
                                           // Posting a claim within this period results in transferring the fees to the burner.
                                           // If the claim is posted after this period, the client submitting the claim gets the fees.

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

    function burn(address recipient, address claimContract, uint value) public {
        require(recipient != address(0), "recipient address must not be zero address");
        require(participatingTokenContracts[claimContract] == true, "claim contract address is not registered");
        require(balanceOf(msg.sender) >= value, 'sender has not enough tokens');
        _burn(msg.sender, value);
        emit Burn(recipient, claimContract, value);
    }

    function claim(
        bytes memory rlpHeader,             // rlp-encoded header of the block containing burn tx along with its receipt
        bytes memory rlpEncodedTx,          // rlp-encoded burn tx
        bytes memory rlpEncodedReceipt,     // rlp-encoded receipt of burn tx ('burn receipt)
        bytes memory rlpMerkleProofTx,      // rlp-encoded Merkle proof of Membership for burn tx (later passed to relay)
        bytes memory rlpMerkleProofReceipt, // rlp-encoded Merkle proof of Membership for burn receipt (later passed to relay)
        bytes memory path                   // the path from the root node down to the burn tx/receipt in the corresponding Merkle tries (tx, receipt).
                                            // path is the same for both tx and its receipt.
    ) public {

        ClaimData memory c = extractClaim(rlpEncodedTx, rlpEncodedReceipt);
        bytes32 txHash = keccak256(rlpEncodedTx);

        // check pre-conditions
        require(claimedTransactions[txHash] == false, "tokens have already been claimed");
        require(participatingTokenContracts[c.burnContract] == true, "burn contract address is not registered");
        require(c.claimContract == address(this), "this contract has not been specified as destination token contract");
        require(c.isBurnValid == true, "burn transaction was not successful (e.g., require statement was violated)");

        // verify inclusion of burn transaction
        uint txExists = txInclusionVerifier.verifyTransaction(0, rlpHeader, REQUIRED_TX_CONFIRMATIONS, rlpEncodedTx, path, rlpMerkleProofTx);
        require(txExists == 0, "burn transaction does not exist or has not enough confirmations");

        // verify inclusion of receipt
        uint receiptExists = txInclusionVerifier.verifyReceipt(0, rlpHeader, REQUIRED_TX_CONFIRMATIONS, rlpEncodedReceipt, path, rlpMerkleProofReceipt);
        require(receiptExists == 0, "burn receipt does not exist or has not enough confirmations");

        uint fee = calculateFee(c.value, TRANSFER_FEE);
        uint remainingValue = c.value - fee;
        address feeRecipient = c.recipient;
        if (msg.sender != c.recipient && txInclusionVerifier.isBlockConfirmed(0, keccak256(rlpHeader), FAIR_CLAIM_PERIOD)) {
            // other client wants to claim fees
            // fair claim period has elapsed -> fees go to msg.sender
            feeRecipient = msg.sender;
        }

        // mint fees to feeRecipient
        _mint(feeRecipient, fee);
        // mint remaining value to recipient
        _mint(c.recipient, remainingValue);

        claimedTransactions[txHash] = true; // IMPORTANT: prevent this tx from being used for further claims
        emit Claim(txHash, c.burnContract, c.recipient, feeRecipient, remainingValue, fee);
    }

    function extractClaim(bytes memory rlpTransaction, bytes memory rlpReceipt) private pure returns (ClaimData memory) {
        ClaimData memory c;
        // parse transaction
        RLPReader.RLPItem[] memory transaction = rlpTransaction.toRlpItem().toList();
        c.burnContract = transaction[3].toAddress();

        // parse receipt
        RLPReader.RLPItem[] memory receipt = rlpReceipt.toRlpItem().toList();
        c.isBurnValid = receipt[0].toBoolean();

        // read logs
        RLPReader.RLPItem[] memory logs = receipt[3].toList();
        RLPReader.RLPItem[] memory burnEventTuple = logs[1].toList();  // logs[0] contains the transfer event emitted by the ECR20 method _burn
                                                                       // logs[1] contains the burn event emitted by the method burn (this contract)
        RLPReader.RLPItem[] memory burnEventTopics = burnEventTuple[1].toList();  // topics contain all indexed event fields

        // read value and recipient from burn event
        c.recipient = address(burnEventTopics[1].toUint());  // indices of indexed fields start at 1 (0 is reserved for the hash of the event signature)
        c.claimContract = address(burnEventTopics[2].toUint());
        c.value = burnEventTopics[3].toUint();

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

    event Burn(address indexed recipient, address indexed claimContract, uint indexed value);
    event Claim(
        bytes32 indexed burnTxHash,
        address indexed burnContract,
        address indexed recipient,
        address feeRecipient,
        uint value,
        uint fee
    );
}
