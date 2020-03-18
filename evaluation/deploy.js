const fs = require('fs');
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

   // setup Rinkeby
   let rinkebyNetworkInstance = initNetwork(config.rinkeby);
   let receipt = await deployContract(
       config.rinkeby,
       rinkebyNetworkInstance.web3,
       rinkebyNetworkInstance.contracts.txVerifier,
       [1, 1, true]
   );
   config.rinkeby.contracts.txVerifier.address = receipt.contractAddress;

   receipt = await deployContract(
       config.rinkeby,
       rinkebyNetworkInstance.web3,
       rinkebyNetworkInstance.contracts.protocol,
       [[], config.rinkeby.contracts.txVerifier.address, 100000000]
   );
   config.rinkeby.contracts.protocol.address = receipt.contractAddress;

   // setup Ropsten
   let ropstenNetworkInstance = initNetwork(config.ropsten);
   receipt = await deployContract(
       config.ropsten,
       ropstenNetworkInstance.web3,
       ropstenNetworkInstance.contracts.txVerifier,
       [1, 1, true]
   );
   config.ropsten.contracts.txVerifier.address = receipt.contractAddress;

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

   // update contract addresses in config.json
   const jsonString = JSON.stringify(config);
   fs.writeFileSync('./evaluation/config.json', jsonString);
   console.log('Deployment completed');
}

async function deployContract(networkConfig, web3, contract, constructorArguments) {
   console.log('Deploy contract', contract.name, 'on', networkConfig.name);

   let deployTx = await contract.instance.deploy({
      data: contract.bytecode,
      arguments: constructorArguments
   });
   let txCount = await web3.eth.getTransactionCount(networkConfig.account.address);
   let tx = {
      from: networkConfig.account.address,
      gasLimit: 7000000,
      gasPrice: web3.utils.toHex(await web3.eth.getGasPrice()),
      nonce: txCount,
      data: deployTx.encodeABI(),
      chainId: networkConfig.chainId
   };
   let signedTx = await web3.eth.accounts.signTransaction(tx, networkConfig.account.privateKey);
   let txReceipt;
   await web3.eth.sendSignedTransaction(signedTx.raw || signedTx.rawTransaction)
       .on("receipt", receipt => {
          console.log('Transaction Hash:', receipt.transactionHash);
          console.log('Contract Address:', receipt.contractAddress);
          txReceipt = receipt;
       })
       .on("error", err => {
          console.log(err);
       });

   return txReceipt;
}

async function registerTokenContract(networkConfig, networkInstance, contractAddrToRegister) {
   return await callContract(
       networkConfig,
       networkInstance.web3,
       networkConfig.contracts.protocol.address,
       networkInstance.contracts.protocol.instance.methods.registerTokenContract(contractAddrToRegister)
   );
}