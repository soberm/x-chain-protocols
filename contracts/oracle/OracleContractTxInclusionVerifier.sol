// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./OracleContract.sol";
import "../TxInclusionVerifier.sol";
import "../RLPReader.sol";
import "../MerklePatriciaProof.sol";

contract OracleContractTxInclusionVerifier is OracleContract, TxInclusionVerifier {

    using RLPReader for *;

    constructor(address _registryContract, address _distKeyContract) OracleContract(_registryContract, _distKeyContract) {}

    function isBlockConfirmed(uint /*feeInWei*/, bytes32 blockHash, uint /*requiredConfirmations*/) payable public override returns (bool) {
        return findBlockValidationResult(blockHash);
    }

    function verifyTransaction(uint /*feeInWei*/, bytes memory rlpHeader, uint8 /*noOfConfirmations*/, bytes memory rlpEncodedTx, bytes memory path, bytes memory rlpEncodedNodes) payable public override returns (uint8) {
        return verify(rlpHeader, rlpEncodedTx, path, rlpEncodedNodes, 4);
    }

    function verifyReceipt(uint /*feeInWei*/, bytes memory rlpHeader, uint8 /*noOfConfirmations*/, bytes memory rlpEncodedReceipt, bytes memory path, bytes memory rlpEncodedNodes) payable public override returns (uint8) {
        return verify(rlpHeader, rlpEncodedReceipt, path, rlpEncodedNodes, 5);
    }

    function verifyState(uint /*feeInWei*/, bytes memory rlpHeader, uint8 /*noOfConfirmations*/, bytes memory rlpEncodedState, bytes memory path, bytes memory rlpEncodedNodes) payable public override returns (uint8) {
        return verify(rlpHeader, rlpEncodedState, path, rlpEncodedNodes, 3);
    }

    function verify(bytes memory rlpHeader, bytes memory rlpEncodedValue, bytes memory path, bytes memory rlpEncodedNodes, uint8 hashPos) internal view returns (uint8) {

        bytes32 blockHash = keccak256(rlpHeader);

        if (!findBlockValidationResult(blockHash)) {
            return 0;
        }

        uint8 result = uint8(MerklePatriciaProof.verify(rlpEncodedValue, path, rlpEncodedNodes, getHash(rlpHeader, hashPos)));
        if (result == 0) {
            return 1;
        }
        return 0;
    }

    function getHash(bytes memory rlpHeader, uint8 position) private pure returns (bytes32) {
        RLPReader.Iterator memory it = rlpHeader.toRlpItem().iterator();
        uint8 idx;
        while(it.hasNext()) {
            if (idx == position) {
                return bytes32(it.next().toUint());
            }

            it.next();
            idx++;
        }

        return 0;
    }
}