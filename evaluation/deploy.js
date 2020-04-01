const fs = require('fs');
const { createRLPHeader } = require('../utils');
const { initNetwork, callContract } = require('./common');
const config = require('./config');


module.exports = async function(callback) {
   try {
      await setUpContracts();
      callback();
   } catch (err) {
      callback(err);
   }
};

async function setUpContracts() {
   console.log('Deploy contracts ...');

   let rinkebyNetworkInstance = initNetwork(config.rinkeby);
   let ropstenNetworkInstance = initNetwork(config.ropsten);

   // setup Rinkeby
   let receipt = await deployContract(
       config.rinkeby,
       rinkebyNetworkInstance.web3,
       rinkebyNetworkInstance.contracts.ethash,
       []
   );
   config.rinkeby.contracts.ethash.address = receipt.contractAddress;

   let mostRecentBlock = await ropstenNetworkInstance.web3.eth.getBlock('latest');
   let genesisBlock = await ropstenNetworkInstance.web3.eth.getBlock(mostRecentBlock.number - 10);  // make sure genesis block is confirmed by enough blocks
   let rlpHeader = createRLPHeader(genesisBlock);
   receipt = await deployContract(
       config.rinkeby,
       rinkebyNetworkInstance.web3,
       rinkebyNetworkInstance.contracts.txVerifier,
       [rlpHeader, genesisBlock.totalDifficulty, config.rinkeby.contracts.ethash.address]
   );
   config.rinkeby.contracts.txVerifier.address = receipt.contractAddress;
   config.rinkeby.contracts.txVerifier.genesisBlock = genesisBlock.number;

   receipt = await deployContract(
       config.rinkeby,
       rinkebyNetworkInstance.web3,
       rinkebyNetworkInstance.contracts.protocol,
       [[], config.rinkeby.contracts.txVerifier.address, 100000000]
   );
   config.rinkeby.contracts.protocol.address = receipt.contractAddress;

   // setup Ropsten
   receipt = await deployContract(
       config.ropsten,
       ropstenNetworkInstance.web3,
       ropstenNetworkInstance.contracts.ethash,
       []
   );
   config.ropsten.contracts.ethash.address = receipt.contractAddress;

   mostRecentBlock = await rinkebyNetworkInstance.web3.eth.getBlock('latest');
   genesisBlock = await rinkebyNetworkInstance.web3.eth.getBlock(mostRecentBlock.number - 10);  // make sure genesis block is confirmed by enough blocks
   rlpHeader = createRLPHeader(genesisBlock);
   receipt = await deployContract(
       config.ropsten,
       ropstenNetworkInstance.web3,
       ropstenNetworkInstance.contracts.txVerifier,
       [rlpHeader, genesisBlock.totalDifficulty, config.ropsten.contracts.ethash.address]
   );
   config.ropsten.contracts.txVerifier.address = receipt.contractAddress;
   config.ropsten.contracts.txVerifier.genesisBlock = genesisBlock.number;

   receipt = await deployContract(
       config.ropsten,
       ropstenNetworkInstance.web3,
       ropstenNetworkInstance.contracts.protocol,
       [[], config.ropsten.contracts.txVerifier.address, 100000000]
   );
   config.ropsten.contracts.protocol.address = receipt.contractAddress;

   // register token contracts
   await registerTokenContract(config.rinkeby, rinkebyNetworkInstance, config.ropsten.contracts.protocol.address);
   await registerTokenContract(config.ropsten, ropstenNetworkInstance, config.rinkeby.contracts.protocol.address);

   updateConfigJson(config);
   console.log('Deployment completed');
}

async function deployContract(networkConfig, web3, contract, constructorArguments) {
   console.log('Deploy contract', contract.name, 'on', networkConfig.name);

   let deployTx = await contract.instance.deploy({
      data: contract.bytecode,
      arguments: constructorArguments
   });
   let txCount = await web3.eth.getTransactionCount(networkConfig.accounts.user.address);
   let tx = {
      from: networkConfig.accounts.user.address,
      gasLimit: 7000000,
      gasPrice: web3.utils.toHex(await web3.eth.getGasPrice()),
      nonce: txCount,
      data: deployTx.encodeABI(),
      chainId: networkConfig.chainId
   };
   let signedTx = await web3.eth.accounts.signTransaction(tx, networkConfig.accounts.user.privateKey);
   let txReceipt = await web3.eth.sendSignedTransaction(signedTx.raw || signedTx.rawTransaction);
   console.log('Transaction Hash:', txReceipt.transactionHash);
   console.log('Contract Address:', txReceipt.contractAddress);

   return txReceipt;
}

async function registerTokenContract(networkConfig, networkInstance, contractAddrToRegister) {
   return await callContract(
       networkConfig,
       networkConfig.accounts.user,
       networkInstance.web3,
       networkConfig.contracts.protocol.address,
       networkInstance.contracts.protocol.instance.methods.registerTokenContract(contractAddrToRegister)
   );
}

function updateConfigJson(config) {
   const jsonString = JSON.stringify(config);
   fs.writeFileSync('./evaluation/config.json', jsonString);
}