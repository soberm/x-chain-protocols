const {BN} = require('@openzeppelin/test-helpers');
const {
   asyncTrieProve,
   asyncTriePut,
   newTrie,
   createRLPHeader,
   createRLPTransaction,
   createRLPReceipt
} = require('../utils');
const RLP = require('rlp');
const fs = require('fs');

const TokenContract = artifacts.require('BurnClaimConfirm');
const TxInclusionVerifier = artifacts.require('MockedTxInclusionVerifier');

const InitialBalanceBurnContract = 1000000000;
const InitialBalanceDestinationContract = 1000000000;
const RequiredStake = 1;


let txInclusionVerifier;
let burnContract;
let claimContract;
let accounts;
let sender;
let recipient;


module.exports = async function(callback) {
   try {
      await setupContracts(1, 1, false);
      await startEvaluation();
      callback();
   } catch (err) {
      callback(err);
   }
};

async function startEvaluation(genesisBlock, startBlock, noOfBlocks) {
   console.log(`+++ Starting evaluation +++`);
   console.log('BurnContract: ', burnContract.address);
   console.log('ClaimContract: ', claimContract.address);

   const fd = fs.openSync(`./evaluation/results.csv`, "w");
   fs.writeSync(fd, "run,gas_burn,gas_claim,gas_confirm\n");

   for (let run = 1; run <= 10000; run++) {
      let value = run;
      const burnResult = await burnContract.burn(recipient, claimContract.address, new BN(value), new BN(RequiredStake), {
         from: sender,
      });

      const gasConsBurn = burnResult.receipt.gasUsed;

      let block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      let tx                = await web3.eth.getTransaction(burnResult.tx);
      let txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      let rlpHeader         = createRLPHeader(block);
      let rlpEncodedTx      = createRLPTransaction(tx);
      let rlpEncodedReceipt = createRLPReceipt(txReceipt);
      let path = RLP.encode(tx.transactionIndex);
      let rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      let rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      const claimResult = await claimContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
      const gasConsClaim = claimResult.receipt.gasUsed;

      block             = await web3.eth.getBlock(claimResult.receipt.blockHash);
      tx                = await web3.eth.getTransaction(claimResult.tx);
      txReceipt         = await web3.eth.getTransactionReceipt(claimResult.tx);
      rlpHeader         = createRLPHeader(block);
      rlpEncodedTx      = createRLPTransaction(tx);
      rlpEncodedReceipt = createRLPReceipt(txReceipt);
      path = RLP.encode(tx.transactionIndex);
      rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      const confirmResult = await burnContract.confirm(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path, {
         from: sender
      });
      const gasConsConfirm = confirmResult.receipt.gasUsed;

      console.log(`${run}: ${gasConsBurn},${gasConsClaim},${gasConsConfirm}`);
      fs.writeSync(fd, `${run},${gasConsBurn},${gasConsClaim},${gasConsConfirm}\n`);
   }

   fs.closeSync(fd);
   console.log(`+++ Done +++`);
}

const setupContracts = async (verifyTxResult, verifyReceiptResult, blockConfirmationResult) => {
   await web3.eth.getAccounts((err,res) => accounts = res);
   sender = accounts[0];
   recipient = accounts[1];

   txInclusionVerifier = await TxInclusionVerifier.new(verifyTxResult, verifyReceiptResult, blockConfirmationResult, { from: sender });
   burnContract = await TokenContract.new([], txInclusionVerifier.address, InitialBalanceBurnContract, { from: sender });
   claimContract = await TokenContract.new([], txInclusionVerifier.address, InitialBalanceDestinationContract, { from: sender });
   await burnContract.registerTokenContract(claimContract.address, { from: sender });
   await claimContract.registerTokenContract(burnContract.address, { from: sender });
};

const createTxMerkleProof = async (block, transactionIndex) => {
   const trie = newTrie();

   for (let i=0; i<block.transactions.length; i++) {
      const tx = await web3.eth.getTransaction(block.transactions[i]);
      const rlpTx = createRLPTransaction(tx);
      const key = RLP.encode(i);
      await asyncTriePut(trie, key, rlpTx);
   }

   const key = RLP.encode(transactionIndex);
   return RLP.encode(await asyncTrieProve(trie, key));
};

const createReceiptMerkleProof = async (block, transactionIndex) => {
   const trie = newTrie();

   for (let i=0; i<block.transactions.length; i++) {
      const receipt = await web3.eth.getTransactionReceipt(block.transactions[i]);
      const rlpReceipt = createRLPReceipt(receipt);
      const key = RLP.encode(i);
      await asyncTriePut(trie, key, rlpReceipt);
   }

   const key = RLP.encode(transactionIndex);
   return RLP.encode(await asyncTrieProve(trie, key));
};