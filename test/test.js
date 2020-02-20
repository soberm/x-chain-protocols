const {
    BN,           // Big Number support
    constants,    // Common constants, like the zero address and largest integers
    expectEvent,  // Assertions for emitted events
    expectRevert, // Assertions for transactions that should fail
    ether,
} = require('@openzeppelin/test-helpers');
const {
   asyncTrieProve,
   asyncTriePut,
   newTrie,
   createRLPHeader,
   createRLPTransaction,
   createRLPReceipt
} = require('../utils');
const {expect} = require('chai');
const RLP = require('rlp');

const TokenContract = artifacts.require('BurnClaim');
const TxInclusionVerifier = artifacts.require('MockedTxInclusionVerifier');

const InitialBalanceSourceContract = 10;
const InitialBalanceDestinationContract = 10;

contract('BurnClaim', (accounts) => {
   let sourceTokenContract;  // token contract living on the source blockchain (tokens are burnt on this chain)
   let destinationTokenContract;  // token contract living on the destination blockchian (tokens are claimed on this chain)
   let txInclusionVerifier;

   beforeEach(async () => {
      await await setupContracts(1, 1, true);
   });

   const setupContracts = async (verifyTxResult, verifyReceiptResult, blockConfirmationResult) => {
      txInclusionVerifier = await TxInclusionVerifier.new(verifyTxResult, verifyReceiptResult, blockConfirmationResult);
      sourceTokenContract = await TokenContract.new([], txInclusionVerifier.address, InitialBalanceSourceContract);
      destinationTokenContract = await TokenContract.new([], txInclusionVerifier.address, InitialBalanceDestinationContract);
      await sourceTokenContract.registerTokenContract(destinationTokenContract.address);
      await destinationTokenContract.registerTokenContract(sourceTokenContract.address);
   };

   it('should deploy the source and destination contracts correctly', async () => {
      let balance;
      balance = await sourceTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract));

      balance = await destinationTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract));
   });

   it('should burn tokens correctly', async () => {
      const sender = accounts[0];
      const value = 5;
      const recipient = accounts[0];
      const result = await sourceTokenContract.burn(recipient, destinationTokenContract.address, value, {
         from: sender
      });
      const balance = await sourceTokenContract.balanceOf(sender);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));
      expectEvent(result.receipt, 'Transfer', {
         from: sender,
         to: constants.ZERO_ADDRESS,
         value: new BN(value),
      });
      expectEvent(result.receipt, 'Burn', {
         recipient: recipient,
         destinationTokenContract: destinationTokenContract.address,
         value: new BN(value)
      });
   });

   it('should not burn tokens if user has not enough tokens', async () => {
      await expectRevert(sourceTokenContract.burn(accounts[0], destinationTokenContract.address, new BN(InitialBalanceSourceContract + 1)), 'ERC20: burn amount exceeds balance');
      const balance = await sourceTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract));
   });

   it('should not burn tokens if destination chain is zero address', async () => {
      await expectRevert(sourceTokenContract.burn(accounts[0], constants.ZERO_ADDRESS, new BN(1)), 'destination token contract address is not registered');
      const balance = await sourceTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract));
   });

   it('should not burn tokens if destination chain does not exist', async () => {
      await expectRevert(sourceTokenContract.burn(accounts[0], sourceTokenContract.address, new BN(1)), 'destination token contract address is not registered');
      const balance = await sourceTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract));
   });

   it('should not burn tokens if recipient is zero address', async () => {
      await expectRevert(sourceTokenContract.burn(constants.ZERO_ADDRESS, sourceTokenContract.address, new BN(1)), 'recipient address must not be zero address');
      const balance = await sourceTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract));
   });

   it('burner should claim tokens correctly (within fair claim period)', async () => {
      await setupContracts(1, 1, false);

      const sender = accounts[0];
      const value = 3;
      const expectedFee = 1;
      const recipient = accounts[0];

      const burnResult = await sourceTokenContract.burn(recipient, destinationTokenContract.address, new BN(value), {
         from: sender
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedTx      = createRLPTransaction(tx);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);

      const path = RLP.encode(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      const claimResult = await destinationTokenContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
      expectEvent(claimResult.receipt, 'Claim', {
         burnTxHash: tx.hash,
         sourceTokenContract: sourceTokenContract.address,
         recipient: recipient,
         feeRecipient: recipient,
         value: new BN(value - expectedFee),
         fee: new BN(expectedFee)
      });

      let balance;
      balance = await sourceTokenContract.balanceOf(sender);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await destinationTokenContract.balanceOf(recipient);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract + value));
   });

   it('burner should claim tokens correctly (after fair claim period elapsed)', async () => {
      const sender = accounts[0];
      const value = 3;
      const expectedFee = 1;
      const recipient = accounts[0];

      const burnResult = await sourceTokenContract.burn(recipient, destinationTokenContract.address, new BN(value), {
         from: sender
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedTx      = createRLPTransaction(tx);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);

      const path = RLP.encode(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      const claimResult = await destinationTokenContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path, {
         from: sender
      });
      expectEvent(claimResult.receipt, 'Claim', {
         burnTxHash: tx.hash,
         sourceTokenContract: sourceTokenContract.address,
         recipient: recipient,
         feeRecipient: recipient,
         value: new BN(value - expectedFee),
         fee: new BN(expectedFee)
      });

      let balance;
      balance = await sourceTokenContract.balanceOf(sender);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await destinationTokenContract.balanceOf(recipient);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract + value));
   });

   it('other client should claim tokens correctly (after fair claim period elapsed)', async () => {
      const sender = accounts[0];
      const claimer = accounts[1];
      const value = 3;
      const expectedFee = 1;
      const recipient = accounts[0];

      const burnResult = await sourceTokenContract.burn(recipient, destinationTokenContract.address, new BN(value), {
         from: sender
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedTx      = createRLPTransaction(tx);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);

      const path = RLP.encode(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      const claimResult = await destinationTokenContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path, {
         from: claimer
      });
      expectEvent(claimResult.receipt, 'Claim', {
         burnTxHash: tx.hash,
         sourceTokenContract: sourceTokenContract.address,
         recipient: recipient,
         feeRecipient: claimer,
         value: new BN(value - expectedFee),
         fee: new BN(expectedFee)
      });

      let balance;
      balance = await sourceTokenContract.balanceOf(sender);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await destinationTokenContract.balanceOf(recipient);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract + value - expectedFee));

      balance = await destinationTokenContract.balanceOf(claimer);
      expect(balance).to.be.bignumber.equal(new BN(expectedFee));
   });

   it('other client should claim tokens correctly but not receive any fee (within fair claim period)', async () => {
      await setupContracts(1, 1, false);

      const sender = accounts[0];
      const claimer = accounts[1];
      const value = 3;
      const expectedFee = 1;
      const recipient = accounts[0];

      const burnResult = await sourceTokenContract.burn(recipient, destinationTokenContract.address, new BN(value), {
         from: sender
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedTx      = createRLPTransaction(tx);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);

      const path = RLP.encode(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      const claimResult = await destinationTokenContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path, {
         from: claimer
      });
      expectEvent(claimResult.receipt, 'Claim', {
         burnTxHash: tx.hash,
         sourceTokenContract: sourceTokenContract.address,
         recipient: recipient,
         feeRecipient: recipient,
         value: new BN(value - expectedFee),
         fee: new BN(expectedFee)
      });

      let balance;
      balance = await sourceTokenContract.balanceOf(sender);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await destinationTokenContract.balanceOf(recipient);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract + value));

      balance = await destinationTokenContract.balanceOf(claimer);
      expect(balance).to.be.bignumber.equal(new BN(0));  // other client should not have received any fee
   });


   it('should not claim tokens if the contract that burnt the tokens does not exist', async () => {
      const sender = accounts[0];
      const value = 3;
      const recipient = accounts[0];

      const burnResult = await sourceTokenContract.burn(recipient, destinationTokenContract.address, new BN(value), {
         from: sender
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);
      const modifiedTx = {
         ...tx,
         to: destinationTokenContract.address
      };
      const rlpEncodedTx = createRLPTransaction(modifiedTx);

      const path = RLP.encode(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      await expectRevert(destinationTokenContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path),
          'contract address is not registered');

      let balance;
      balance = await sourceTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await destinationTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract));
   });

   it('should not claim tokens if burn transaction was not successful (modify burn receipt)', async () => {
      const sender = accounts[0];
      const value = 3;
      const recipient = accounts[0];

      const burnResult = await sourceTokenContract.burn(recipient, destinationTokenContract.address, new BN(value), {
         from: sender
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedTx      = createRLPTransaction(tx);
      const modifiedReceipt = {
         ...txReceipt,
         status: false
      };
      const rlpEncodedReceipt = createRLPReceipt(modifiedReceipt);

      const path = RLP.encode(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      await expectRevert(destinationTokenContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path),
          'burn transaction was not successful');

      let balance;
      balance = await sourceTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await destinationTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract));
   });

   it('should not claim tokens if burn transaction is not included in source blockchain', async () => {
      await setupContracts(0, 1, true);
      const sender = accounts[0];
      const value = 3;
      const recipient = accounts[0];

      const burnResult = await sourceTokenContract.burn(recipient, destinationTokenContract.address, new BN(value), {
         from: sender
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedTx      = createRLPTransaction(tx);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);

      const path = RLP.encode(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      await expectRevert(destinationTokenContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path),
          'burn transaction does not exist or has not enough confirmations');

      let balance;
      balance = await sourceTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await destinationTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract));
   });

   it('should not claim tokens if receipt of burn transaction is not included in source blockchain', async () => {
      await setupContracts(1, 0, true);
      const sender = accounts[0];
      const value = 3;
      const recipient = accounts[0];

      const burnResult = await sourceTokenContract.burn(recipient, destinationTokenContract.address, new BN(value), {
         from: sender
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedTx      = createRLPTransaction(tx);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);

      const path = RLP.encode(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      await expectRevert(destinationTokenContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path),
          'burn receipt does not exist or has not enough confirmations');

      let balance;
      balance = await sourceTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await destinationTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract));
   });

   it('should not allow tokens to be claimed twice', async () => {
      const sender = accounts[0];
      const value = 3;
      const expectedFee = 1;
      const recipient = accounts[0];

      const burnResult = await sourceTokenContract.burn(recipient, destinationTokenContract.address, new BN(value), {
         from: sender
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedTx      = createRLPTransaction(tx);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);

      const path = RLP.encode(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      const claimResult = await destinationTokenContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
      expectEvent(claimResult.receipt, 'Claim', {
         burnTxHash: tx.hash,
         sourceTokenContract: sourceTokenContract.address,
         recipient: recipient,
         feeRecipient: recipient,
         value: new BN(value - expectedFee),
         fee: new BN(expectedFee)
      });

      await expectRevert(destinationTokenContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path),
          'tokens have already been claimed');

      let balance;
      balance = await sourceTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await destinationTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract + value));
   });

   it('should not allow to claim tokens on wrong destination token contract', async () => {
      const sender = accounts[0];
      const value = 3;
      const recipient = accounts[0];

      await sourceTokenContract.registerTokenContract(sourceTokenContract.address);
      const burnResult = await sourceTokenContract.burn(recipient, sourceTokenContract.address, new BN(value), {
         from: sender
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedTx      = createRLPTransaction(tx);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);

      const path = RLP.encode(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      await expectRevert(destinationTokenContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path),
          'this contract has not been specified as destination token contract');

      let balance;
      balance = await sourceTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await destinationTokenContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract));
   });

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
   }

});
