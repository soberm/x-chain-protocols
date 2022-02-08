// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./TxInclusionVerifier.sol";

/**
   This contract is used for automated tests.
*/
contract MockedTxInclusionVerifier is TxInclusionVerifier {

    uint8 verifyTxResult;
    uint8 verifyReceiptResult;
    bool blockConfirmationResult;

    constructor(uint8 _verifyTxResult, uint8 _verifyReceiptResult, bool _blockConfirmationResult) {
        verifyTxResult = _verifyTxResult;
        verifyReceiptResult = _verifyReceiptResult;
        blockConfirmationResult = _blockConfirmationResult;
    }

    function isBlockConfirmed(uint /*feeInWei*/, bytes32 /*blockHash*/, uint /*requiredConfirmations*/) override payable public returns (bool) {
        return blockConfirmationResult;
    }

    function verifyTransaction(uint /*feeInWei*/, bytes memory /*rlpHeader*/, uint8 /*noOfConfirmations*/, bytes memory /*rlpEncodedTx*/,
        bytes memory /*path*/, bytes memory /*rlpEncodedNodes*/) override payable public returns (uint8) {
        return verifyTxResult;
    }

    function verifyReceipt(uint /*feeInWei*/, bytes memory /*rlpHeader*/, uint8 /*noOfConfirmations*/, bytes memory /*rlpEncodedReceipt*/,
        bytes memory /*path*/, bytes memory /*rlpEncodedNodes*/) override payable public returns (uint8) {
        return verifyReceiptResult;
    }

    function verifyState(uint /*feeInWei*/, bytes memory /*rlpHeader*/, uint8 /*noOfConfirmations*/, bytes memory /*rlpEncodedState*/,
        bytes memory /*path*/, bytes memory /*rlpEncodedNodes*/) override payable public returns (uint8) {
        return 0;
    }

}
