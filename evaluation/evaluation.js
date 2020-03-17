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
const Web3 = require('web3');

const ropsten = {
   name: 'Ropsten',
   url: 'wss://ropsten.infura.io/ws/v3/<projectID>',
   chainId: 3,
   account: {
      address: '0xEE4Fd3b858A2560caeb3a42Db552707928d07E52',
      privateKey: '<privateKey>'
   },
   confirmations: 5,
   web3: undefined,
   contracts: {
      txVerifier: {
         name: 'MockedTxInclusionVerifier',
         object: undefined,
         bytecode: undefined,
         address: '0xd5fbea7d9c816ca1ffbc904de9ef06e4d9e8d6fb',  // if address is undefined, contract will be automatically deployed
      },
      protocol: {
         name: 'Protocol',
         object: undefined,
         bytecode: undefined,
         address: '0xa2c84468a203ebedd85c0d9d42455c590814c484',  // if address is undefined, contract will be automatically deployed
      }
   }
};

const rinkeby = {
   name: 'Rinkeby',
   url: 'wss://rinkeby.infura.io/ws/v3/<projectID>',
   chainId: 4,
   account: {
       address: '0x3aE25CA7B8198150f956af99A87372327c0E9f13',
       privateKey: '<privateKey>'
   },
   confirmations: 5,
   web3: undefined,
   contracts: {
      txVerifier: {
         name: 'MockedTxInclusionVerifier',
         object: undefined,
         bytecode: undefined,
         address: '0x841f17b6e1989a7ccd17a33da9c80275dcd4ed16',   // if address is undefined, contract will be automatically deployed
      },
      protocol: {
         name: 'Protocol',
         object: undefined,
         bytecode: undefined,
         address: '0x661e598bed7d4c43a5b4ebc2c0fb9b90826701cf'    // if address is undefined, contract will be automatically deployed
      }
   }
};


module.exports = async function(callback) {
   try {
      await setUpContracts();
      await startEvaluation();
      callback();
   } catch (err) {
      callback(err);
   }
};

async function setUpContracts() {
   console.log('Setup contracts...');

   let receipt;
   let deployedRinkeby = false;
   let deployedRopsten = false;

   // setup Rinkeby
   initNetwork(rinkeby);
   if (rinkeby.contracts.txVerifier.address === undefined) {
      receipt = await deployContract(rinkeby, rinkeby.contracts.txVerifier, [1, 1, true]);
      rinkeby.contracts.txVerifier.address = receipt.contractAddress;
   }
   if (rinkeby.contracts.protocol.address === undefined) {
      receipt = await deployContract(rinkeby, rinkeby.contracts.protocol, [[], rinkeby.contracts.txVerifier.address, 100000000]);
      rinkeby.contracts.protocol.address = receipt.contractAddress;
      deployedRinkeby = true;
   }

   // setup Ropsten
   initNetwork(ropsten);
   if (ropsten.contracts.txVerifier.address === undefined) {
      receipt = await deployContract(ropsten, ropsten.contracts.txVerifier, [1, 1, true]);
      ropsten.contracts.txVerifier.address = receipt.contractAddress;
   }
   if (ropsten.contracts.protocol.address === undefined) {
      receipt = await deployContract(ropsten, ropsten.contracts.protocol, [[], ropsten.contracts.txVerifier.address, 100000000]);
      ropsten.contracts.protocol.address = receipt.contractAddress;
      deployedRopsten = true;
   }

   // register token contracts
   if (deployedRinkeby) {
      // only call this function if contract has been deployed for the first time (was not deployed before)
      await registerTokenContract(rinkeby, ropsten.contracts.protocol.address);
   }
   if (deployedRopsten) {
      // only call this function if contract has been deployed for the first time (was not deployed before)
      await registerTokenContract(ropsten, rinkeby.contracts.protocol.address);
   }

   console.log('Setup completed');
}

async function startEvaluation() {
   console.log(`+++ Starting evaluation +++`);

   const fd = fs.openSync(`./evaluation/results.csv`, "w");
   fs.writeSync(fd, "run,burn_gas,claim_gas,confirm_gas,burn_incTime,burn_confTime,claim_incTime,claim_confTime,confirm_incTime,confirm_confTime\n");

   for (let run = 1; run <= 1; run++) {
      let result = {
         burn: {},
         claim: {},
         confirm: {}
      };
      console.log('Run:', run);

      // submit burn transaction
      let startTime = new Date().getTime();
      const burnReceipt = await burn(rinkeby, ropsten.account.address, ropsten.contracts.protocol.address, 1, 0);
      let endTime = new Date().getTime();
      result.burn.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds

      console.log('wait for confirmation of burn tx ...');
      startTime = new Date().getTime();
      await waitUntilConfirmed(rinkeby, burnReceipt.transactionHash, rinkeby.confirmations);
      endTime = new Date().getTime();
      result.burn.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
      console.log('burn tx is confirmed');
      result.burn.gasConsumption = burnReceipt.gasUsed;


      // submit claim transaction
      let block             = await rinkeby.web3.eth.getBlock(burnReceipt.blockHash);
      let tx                = await rinkeby.web3.eth.getTransaction(burnReceipt.transactionHash);
      let txReceipt         = await rinkeby.web3.eth.getTransactionReceipt(burnReceipt.transactionHash);
      let rlpHeader         = createRLPHeader(block);
      let rlpEncodedTx      = createRLPTransaction(tx, rinkeby.chainId);
      let rlpEncodedReceipt = createRLPReceipt(txReceipt);
      let path = RLP.encode(tx.transactionIndex);
      let rlpEncodedTxNodes = await createTxMerkleProof(rinkeby, block, tx.transactionIndex);
      let rlpEncodedReceiptNodes = await createReceiptMerkleProof(rinkeby, block, tx.transactionIndex);

      startTime = new Date().getTime();
      const claimReceipt = await claim(ropsten, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
      endTime = new Date().getTime();
      result.claim.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds

      console.log('wait for confirmation of claim tx ...');
      startTime = new Date().getTime();
      await waitUntilConfirmed(ropsten, claimReceipt.transactionHash, ropsten.confirmations);
      endTime = new Date().getTime();
      result.claim.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
      console.log('claim tx is confirmed');
      result.claim.gasConsumption = claimReceipt.gasUsed;


      // submit confirm transaction
      block             = await ropsten.web3.eth.getBlock(claimReceipt.blockHash);
      tx                = await ropsten.web3.eth.getTransaction(claimReceipt.transactionHash);
      txReceipt         = await ropsten.web3.eth.getTransactionReceipt(claimReceipt.transactionHash);
      rlpHeader         = createRLPHeader(block);
      rlpEncodedTx      = createRLPTransaction(tx, ropsten.chainId);
      rlpEncodedReceipt = createRLPReceipt(txReceipt);
      path = RLP.encode(tx.transactionIndex);
      rlpEncodedTxNodes = await createTxMerkleProof(ropsten, block, tx.transactionIndex);
      rlpEncodedReceiptNodes = await createReceiptMerkleProof(ropsten, block, tx.transactionIndex);

      startTime = new Date().getTime();
      const confirmReceipt = await confirm(rinkeby, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
      endTime = new Date().getTime();
      result.confirm.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds

      console.log('wait for confirmation of confirm tx ...');
      startTime = new Date().getTime();
      await waitUntilConfirmed(rinkeby, confirmReceipt.transactionHash, rinkeby.confirmations);
      endTime = new Date().getTime();
      result.confirm.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
      console.log('confirm tx is confirmed');
      result.confirm.gasConsumption = confirmReceipt.gasUsed;

      console.log(`${run}: ${result.burn.gasConsumption},${result.claim.gasConsumption},${result.confirm.gasConsumption},${result.burn.inclusionTime},${result.burn.confirmationTime},${result.claim.inclusionTime},${result.claim.confirmationTime},${result.confirm.inclusionTime},${result.confirm.confirmationTime}`);
      fs.writeSync(fd, `${run},${result.burn.gasConsumption},${result.claim.gasConsumption},${result.confirm.gasConsumption},${result.burn.inclusionTime},${result.burn.confirmationTime},${result.claim.inclusionTime},${result.claim.confirmationTime},${result.confirm.inclusionTime},${result.confirm.confirmationTime}\n`);
   }

   fs.closeSync(fd);
   console.log(`+++ Done +++`);
}

function initNetwork(network) {
   network.web3 = new Web3(new Web3.providers.WebsocketProvider(network.url));

   // create contract object for TxInclusionVerifier
   let jsonFileContent = fs.readFileSync('./build/contracts/MockedTxInclusionVerifier.json');
   let parsedJson = JSON.parse(jsonFileContent);
   network.contracts.txVerifier.bytecode = parsedJson.bytecode;
   network.contracts.txVerifier.object = new web3.eth.Contract(parsedJson.abi);

   // create contract object for Protocol2
   jsonFileContent = fs.readFileSync('./build/contracts/Protocol2.json');
   parsedJson = JSON.parse(jsonFileContent);
   network.contracts.protocol.bytecode = parsedJson.bytecode;
   network.contracts.protocol.object = new web3.eth.Contract(parsedJson.abi);
}

async function registerTokenContract(network, contractAddrToRegister) {
   return await callContract(
       network,
       network.contracts.protocol,
       network.contracts.protocol.object.methods.registerTokenContract(contractAddrToRegister)
   );
}

async function burn(network, recipientAddr, claimContractAddr, value, stake) {
   return await callContract(
       network,
       network.contracts.protocol,
       network.contracts.protocol.object.methods.burn(recipientAddr, claimContractAddr, value, stake)
   );
}

async function claim(network, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path) {
   return await callContract(
       network,
       network.contracts.protocol,
       network.contracts.protocol.object.methods.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path)
   );
}

async function confirm(network, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path) {
   return await callContract(
       network,
       network.contracts.protocol,
       network.contracts.protocol.object.methods.confirm(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path)
   );
}

async function callContract(network, contract, method) {
   console.log('Call function', method._method.name, 'on', network.name);

   let txCount = await network.web3.eth.getTransactionCount(network.account.address);
   let tx = {
      from: network.account.address,
      to: contract.address,
      gasLimit: 1000000,
      gasPrice: network.web3.utils.toHex(await network.web3.eth.getGasPrice()),
      nonce: network.web3.utils.toHex(txCount),
      value: '0x0',
      data: method.encodeABI(),
      chainId: network.chainId
   };
   let signedTx = await network.web3.eth.accounts.signTransaction(tx, network.account.privateKey);
   let txReceipt = undefined;
   await network.web3.eth.sendSignedTransaction(signedTx.raw || signedTx.rawTransaction)
       .on("receipt", receipt => {
          console.log('Transaction Hash:', receipt.transactionHash);
          txReceipt = receipt;
       })
       .on("error", err => {
          console.log(err);
       });

   return txReceipt;
}

async function deployContract(network, contract, constructorArguments) {
   console.log('Deploy contract', contract.name, 'on', network.name);

   let deployTx = await contract.object.deploy({
      data: contract.bytecode,
      arguments: constructorArguments
   });
   let txCount = await network.web3.eth.getTransactionCount(network.account.address);
   let tx = {
      from: network.account.address,
      gasLimit: 7000000,
      gasPrice: network.web3.utils.toHex(await network.web3.eth.getGasPrice()),
      nonce: txCount,
      data: deployTx.encodeABI(),
      chainId: network.chainId
   };
   let signedTx = await network.web3.eth.accounts.signTransaction(tx, network.account.privateKey);
   let txReceipt;
   await network.web3.eth.sendSignedTransaction(signedTx.raw || signedTx.rawTransaction)
       .on("receipt", receipt => {
          console.log('Transaction Hash:', receipt.transactionHash);
          txReceipt = receipt;
       })
       .on("error", err => {
          console.log(err);

       });

   return txReceipt;
}

async function waitUntilConfirmed(network, txHash, confirmations) {
   while (true) {
      let receipt = await network.web3.eth.getTransactionReceipt(txHash);
      if (receipt !== null) {
         let mostRecentBlockNumber = await network.web3.eth.getBlockNumber();
         if (receipt.blockNumber + confirmations <= mostRecentBlockNumber) {
            // receipt != null -> tx is part of main chain
            // and block containing tx has at least confirmations successors
            break;
         }
      }
      sleep(1500);
   }
}

function sleep(ms) {
   return new Promise(resolve => setTimeout(resolve, ms));
}

const createTxMerkleProof = async (network, block, transactionIndex) => {
   const trie = newTrie();

   for (let i=0; i<block.transactions.length; i++) {
      const tx = await network.web3.eth.getTransaction(block.transactions[i]);
      const rlpTx = createRLPTransaction(tx, network.chainId);
      const key = RLP.encode(i);
      await asyncTriePut(trie, key, rlpTx);
   }

   const key = RLP.encode(transactionIndex);
   return RLP.encode(await asyncTrieProve(trie, key));
};

const createReceiptMerkleProof = async (network, block, transactionIndex) => {
   const trie = newTrie();

   for (let i=0; i<block.transactions.length; i++) {
      const receipt = await network.web3.eth.getTransactionReceipt(block.transactions[i]);
      const rlpReceipt = createRLPReceipt(receipt);
      const key = RLP.encode(i);
      await asyncTriePut(trie, key, rlpReceipt);
   }

   const key = RLP.encode(transactionIndex);
   return RLP.encode(await asyncTrieProve(trie, key));
};