const {
    BN,           // Big Number support
    constants,    // Common constants, like the zero address and largest integers
    expectEvent,  // Assertions for emitted events
    expectRevert, // Assertions for transactions that should fail
} = require('@openzeppelin/test-helpers');
const {
   asyncTriePut,
   newTrie,
   createRLPHeader,
   createRLPTransaction,
   createRLPReceipt,
   encodeToBuffer
} = require('../utils');
const {expect} = require('chai');
const RLP = require('rlp');
const {BaseTrie: Trie} = require('merkle-patricia-tree');

const TokenContract = artifacts.require('Protocol2');
const TxInclusionVerifier = artifacts.require('MockedTxInclusionVerifier');

const InitialBalanceSourceContract = 10;
const InitialBalanceDestinationContract = 10;
const RequiredStake = 0;


contract('Protocol2', (accounts) => {
   let burnContract;  // token contract living on the source blockchain (tokens are burnt on this chain)
   let claimContract;  // token contract living on the destination blockchian (tokens are claimed on this chain)
   let txInclusionVerifier;

   beforeEach(async () => {
      await await setupContracts(1, 1, true);
   });

   const setupContracts = async (verifyTxResult, verifyReceiptResult, blockConfirmationResult) => {
      txInclusionVerifier = await TxInclusionVerifier.new(verifyTxResult, verifyReceiptResult, blockConfirmationResult);
      burnContract = await TokenContract.new([], txInclusionVerifier.address, InitialBalanceSourceContract);
      claimContract = await TokenContract.new([], txInclusionVerifier.address, InitialBalanceDestinationContract);
      await burnContract.registerTokenContract(claimContract.address);
      await claimContract.registerTokenContract(burnContract.address);
   };

   it('should deploy the source and destination contracts correctly', async () => {
      let balance;
      balance = await burnContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract));

      balance = await claimContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract));
   });

   it('should burn tokens correctly', async () => {
      const sender = accounts[0];
      const value = 5;
      const recipient = accounts[0];
      const result = await burnContract.burn(recipient, claimContract.address, value, RequiredStake, {
         from: sender,
      });
      const balance = await burnContract.balanceOf(sender);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));
      expectEvent(result.receipt, 'Transfer', {
         from: sender,
         to: constants.ZERO_ADDRESS,
         value: new BN(value),
      });
      expectEvent(result.receipt, 'Burn', {
         sender: sender,
         recipient: recipient,
         claimContract: claimContract.address,
         value: new BN(value)
      });
   });

   it('should not burn tokens if user has not enough tokens', async () => {
      await expectRevert(
          burnContract.burn(accounts[0], claimContract.address, new BN(InitialBalanceSourceContract + 1), RequiredStake, {
             from: accounts[0],
      }), 'ERC20: burn amount exceeds balance');
      const balance = await burnContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract));
   });

   it('should not burn tokens if destination chain is zero address', async () => {
      await expectRevert(burnContract.burn(accounts[0], constants.ZERO_ADDRESS, new BN(1), RequiredStake, {
         from: accounts[0],
      }), 'claim contract address is not registered');
      const balance = await burnContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract));
   });

   it('should not burn tokens if destination chain does not exist', async () => {
      await expectRevert(burnContract.burn(accounts[0], burnContract.address, new BN(1), RequiredStake, {
         from: accounts[0],
      }), 'claim contract address is not registered');
      const balance = await burnContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract));
   });

   it('should not burn tokens if recipient is zero address', async () => {
      await expectRevert(burnContract.burn(constants.ZERO_ADDRESS, burnContract.address, new BN(1), RequiredStake, {
         from: accounts[0],
      }), 'recipient address must not be zero address');
      const balance = await burnContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract));
   });

   it('should not burn tokens if the sender\'s balance is too low', async () => {
      await expectRevert(burnContract.burn(accounts[0], claimContract.address, new BN(11), RequiredStake, {
         from: accounts[0],
      }), 'ERC20: burn amount exceeds balance');
      const balance = await burnContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract));
   });

   it('burner should claim tokens correctly', async () => {
      const sender = accounts[0];
      const value = 3;
      const recipient = accounts[0];

      const burnResult = await burnContract.burn(recipient, claimContract.address, new BN(value), RequiredStake, {
         from: sender,
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedTx      = createRLPTransaction(tx);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);

      const path = encodeToBuffer(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      const claimResult = await claimContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path, {
         from: sender,
      });
      expectEvent(claimResult.receipt, 'Claim', {
         burnContract: burnContract.address,
         sender: sender,
         burnTime: new BN(burnResult.receipt.blockNumber)
      });

      let balance;
      balance = await burnContract.balanceOf(sender);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value - RequiredStake));

      balance = await claimContract.balanceOf(recipient);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract + value));
   });

   it('other client should claim tokens correctly', async () => {
      const sender = accounts[0];
      const recipient = accounts[0];
      const claimer = accounts[1];

      const value = 3;
      const fee = 1;

      const burnResult = await burnContract.burn(recipient, claimContract.address, new BN(value), RequiredStake, {
         from: sender,
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedTx      = createRLPTransaction(tx);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);

      const path = encodeToBuffer(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      const claimResult = await claimContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path, {
         from: claimer
      });
      expectEvent(claimResult.receipt, 'Claim', {
         burnContract: burnContract.address,
         sender: sender,
         burnTime: new BN(burnResult.receipt.blockNumber)
      });

      let balance;
      balance = await burnContract.balanceOf(sender);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await claimContract.balanceOf(recipient);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract + value - fee));
   });

   it('should not claim tokens if the contract that burnt the tokens does not exist', async () => {
      const sender = accounts[0];
      const value = 3;
      const recipient = accounts[0];

      const burnResult = await burnContract.burn(recipient, claimContract.address, new BN(value), RequiredStake, {
         from: sender,
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);
      const modifiedTx = {
         ...tx,
         to: claimContract.address
      };
      const rlpEncodedTx = createRLPTransaction(modifiedTx);

      const path = encodeToBuffer(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      await expectRevert(claimContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path, {
         from: sender,
      }), 'contract address is not registered');

      let balance;
      balance = await burnContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await claimContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract));
   });

   it('should not claim tokens if burn transaction was not successful (modify burn receipt)', async () => {
      const sender = accounts[0];
      const value = 3;
      const recipient = accounts[0];

      const burnResult = await burnContract.burn(recipient, claimContract.address, new BN(value), RequiredStake, {
         from: sender,
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

      const path = encodeToBuffer(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      await expectRevert(
         claimContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path),
         'burn transaction was not successful',
      );

      let balance;
      balance = await burnContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await claimContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract));
   });

   it('should not claim tokens if burn transaction is not included in source blockchain', async () => {
      await setupContracts(0, 1, true);
      const sender = accounts[0];
      const value = 3;
      const recipient = accounts[0];

      const burnResult = await burnContract.burn(recipient, claimContract.address, new BN(value), RequiredStake, {
         from: sender,
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedTx      = createRLPTransaction(tx);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);

      const path = encodeToBuffer(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      await expectRevert(
         claimContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path),
         'burn transaction does not exist or has not enough confirmations',
      );

      let balance;
      balance = await burnContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await claimContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract));
   });

   it('should not claim tokens if receipt of burn transaction is not included in source blockchain', async () => {
      await setupContracts(1, 0, true);
      const sender = accounts[0];
      const value = 3;
      const recipient = accounts[0];

      const burnResult = await burnContract.burn(recipient, claimContract.address, new BN(value), RequiredStake, {
         from: sender,
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedTx      = createRLPTransaction(tx);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);

      const path = encodeToBuffer(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      await expectRevert(
         claimContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path),
         'burn receipt does not exist or has not enough confirmations',
      );

      let balance;
      balance = await burnContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await claimContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract));
   });

   it('should not allow tokens to be claimed twice', async () => {
      const sender = accounts[0];
      const value = 3;
      const recipient = accounts[0];

      const burnResult = await burnContract.burn(recipient, claimContract.address, new BN(value), RequiredStake, {
         from: sender,
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedTx      = createRLPTransaction(tx);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);

      const path = encodeToBuffer(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      const claimResult = await claimContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
      expectEvent(claimResult.receipt, 'Claim', {
         burnContract: burnContract.address,
         sender: sender,
         burnTime: new BN(burnResult.receipt.blockNumber)
      });

      await expectRevert(claimContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path),
          'tokens have already been claimed');

      let balance;
      balance = await burnContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await claimContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract + value));
   });

   it('should not allow to claim tokens on wrong claim contract', async () => {
      const sender = accounts[0];
      const value = 3;
      const recipient = accounts[0];

      await burnContract.registerTokenContract(burnContract.address);
      const burnResult = await burnContract.burn(recipient, burnContract.address, new BN(value), RequiredStake, {
         from: sender,
      });

      const block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      const tx                = await web3.eth.getTransaction(burnResult.tx);
      const txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      const rlpHeader         = createRLPHeader(block);
      const rlpEncodedTx      = createRLPTransaction(tx);
      const rlpEncodedReceipt = createRLPReceipt(txReceipt);

      const path = encodeToBuffer(tx.transactionIndex);
      const rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      const rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      await expectRevert(claimContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path),
          'this contract has not been specified as destination token contract');

      let balance;
      balance = await burnContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));

      balance = await claimContract.balanceOf(accounts[0]);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract));
   });

   // TODO
   it('should confirm claim tx and correctly transfer stake to sender (fair confirm period has not elapsed)', async () => {
      await setupContracts(1, 1, false);

      const sender = accounts[0];
      const value = 3;
      const recipient = accounts[0];

      const burnResult = await burnContract.burn(recipient, claimContract.address, new BN(value), RequiredStake, {
         from: sender,
      });

      let block             = await web3.eth.getBlock(burnResult.receipt.blockHash);
      let tx                = await web3.eth.getTransaction(burnResult.tx);
      let txReceipt         = await web3.eth.getTransactionReceipt(burnResult.tx);
      let rlpHeader         = createRLPHeader(block);
      let rlpEncodedTx      = createRLPTransaction(tx);
      let rlpEncodedReceipt = createRLPReceipt(txReceipt);

      let path = encodeToBuffer(tx.transactionIndex);
      let rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      let rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      const claimResult = await claimContract.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
      block             = await web3.eth.getBlock(claimResult.receipt.blockHash);
      tx                = await web3.eth.getTransaction(claimResult.tx);
      txReceipt         = await web3.eth.getTransactionReceipt(claimResult.tx);
      rlpHeader         = createRLPHeader(block);
      rlpEncodedTx      = createRLPTransaction(tx);
      rlpEncodedReceipt = createRLPReceipt(txReceipt);
      path = encodeToBuffer(tx.transactionIndex);
      rlpEncodedTxNodes = await createTxMerkleProof(block, tx.transactionIndex);
      rlpEncodedReceiptNodes = await createReceiptMerkleProof(block, tx.transactionIndex);

      const confirmResult = await burnContract.confirm(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path, {
         from: sender
      });

      // expectEvent(confirmResult.receipt, 'Confirm1', {
      //    claimContract: claimContract.address
      // });

      // const balanceAfterConfirm = await balance.current(sender);
      // expect(balanceBeforeConfirm.sub(new BN(RequiredStakeWei))).to.be.bignumber.equal(balanceAfterConfirm);
      // let balance;
      let balance = await burnContract.balanceOf(sender);
      expect(balance).to.be.bignumber.equal(new BN(InitialBalanceSourceContract - value));
      //
      // balance = await claimContract.balanceOf(accounts[0]);
      // expect(balance).to.be.bignumber.equal(new BN(InitialBalanceDestinationContract));
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
      return encodeToBuffer(await Trie.createProof(trie, key));
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
      return encodeToBuffer(await Trie.createProof(trie, key));
   }

});