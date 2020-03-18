const { createRLPHeader } = require('../utils');
const { initNetwork, callContract, sleep } = require('./common');
const config = require('./config');


module.exports = async function(callback) {
   try {
      let rinkebyNetworkInstance = initNetwork(config.rinkeby);
      let ropstenNetworkInstance = initNetwork(config.ropsten);
      // await relayHeaders(config.ropsten, ropstenNetworkInstance, config.rinkeby, rinkebyNetworkInstance);
      await relayHeaders(config.rinkeby, rinkebyNetworkInstance, config.ropsten, ropstenNetworkInstance);
      callback();
   } catch (err) {
      callback(err);
   }
};

async function relayHeaders(sourceNetworkConfig, sourceNetworkInstance, destinationNetworkConfig, destinationNetworkInstance) {
   console.log('Relay Headers from', sourceNetworkConfig.name, 'to', destinationNetworkConfig.name, '...');

   let mostRecentHeader = await getMainChainHead(destinationNetworkConfig, destinationNetworkInstance);
   let mostRecentBlock = await sourceNetworkInstance.web3.eth.getBlock(mostRecentHeader);
   let nextBlockNr = mostRecentBlock.number + 1;

   while(true) {
   // for (let i = 0; i < 10; i++) {
      console.log('Relay block', nextBlockNr);

      let nextBlock = await sourceNetworkInstance.web3.eth.getBlock(nextBlockNr);
      if (nextBlock !== null) {
         try {
            await submitHeader(destinationNetworkConfig, destinationNetworkInstance, createRLPHeader(nextBlock));
            nextBlockNr++;
         } catch (e) {
            // tx revert occurred -> parent does not exist within relay -> try parent block
            console.error('Header Submission failed:', e.message);
            nextBlockNr--;
         }
      } else {
         // no block with current number available -> wait
         sleep(1000);
      }
   }
}

/**
 * @returns the hash of the most recent block of the main chain stored within the relay running on the specified blockchain.
 */
async function getMainChainHead(networkConfig, networkInstance) {
   return await networkInstance.contracts.txVerifier.instance.methods.longestChainEndpoint().call();
}

async function submitHeader(networkConfig, networkInstance, rlpEncodedHeader) {
   return await callContract(
       networkConfig,
       networkInstance.web3,
       networkConfig.contracts.txVerifier.address,
       networkInstance.contracts.txVerifier.instance.methods.submitBlock(rlpEncodedHeader)
   );
}