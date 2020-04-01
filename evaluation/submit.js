const { createRLPHeader } = require('../utils');
const { initNetwork, callContract, sleep, getMostRecentBlockHash, isHeaderStored } = require('./common');
const config = require('./config');
const RLP = require('rlp');

const HEADER_BATCH_SIZE = 25;


module.exports = async function(callback) {
   try {
      let sourceNetworkName = process.argv[4];
      let sourceNetworkConfig;
      let sourceNetworkInstance;
      let destinationNetworkConfig;
      let destinationNetworkInstance;
      let rinkebyNetworkInstance = initNetwork(config.rinkeby);
      let ropstenNetworkInstance = initNetwork(config.ropsten);

      if (sourceNetworkName === 'rinkeby') {
         sourceNetworkConfig = config.rinkeby;
         sourceNetworkInstance = rinkebyNetworkInstance;
         destinationNetworkConfig = config.ropsten;
         destinationNetworkInstance = ropstenNetworkInstance;
      }
      else {
         sourceNetworkConfig = config.ropsten;
         sourceNetworkInstance = ropstenNetworkInstance;
         destinationNetworkConfig = config.rinkeby;
         destinationNetworkInstance = rinkebyNetworkInstance;
      }

      await relayHeaders(sourceNetworkConfig, sourceNetworkInstance, destinationNetworkConfig, destinationNetworkInstance);
      callback();
   } catch (err) {
      callback(err);
   }
};

async function relayHeaders(sourceNetworkConfig, sourceNetworkInstance, destinationNetworkConfig, destinationNetworkInstance) {
   console.log('Relay Headers from', sourceNetworkConfig.name, 'to', destinationNetworkConfig.name, '...');

   let mostRecentHeader = await getMostRecentBlockHash(destinationNetworkInstance.contracts.txVerifier);
   let mostRecentBlock = await sourceNetworkInstance.web3.eth.getBlock(mostRecentHeader);
   let nextBlockNr = mostRecentBlock.number + 1;

   while(true) {
      console.log('Next batch starts at block number', nextBlockNr);

      let blocks = [];
      let nextBlock = await sourceNetworkInstance.web3.eth.getBlock(nextBlockNr);

      if (nextBlock !== null) {
         let storedWithinRelay = await isHeaderStored(destinationNetworkInstance.contracts.txVerifier, nextBlock.hash);

         // check if next block is already stored within relay
         if (storedWithinRelay === true) {
            nextBlockNr++;
            continue;
         }

         // check if parent is stored within relay
         storedWithinRelay = await isHeaderStored(destinationNetworkInstance.contracts.txVerifier, nextBlock.parentHash);
         if (storedWithinRelay === false) {
            // parent not known to relay -> decrement nextBlockNr and try again
            nextBlockNr--;
            continue;
         }

         blocks.push(nextBlock);
         nextBlockNr++;

         nextBlock = await sourceNetworkInstance.web3.eth.getBlock(nextBlockNr);
         while (nextBlock !== null && blocks.length < HEADER_BATCH_SIZE) { // max HEADER_BATCH_SIZE blocks per batch
            blocks.push(nextBlock);
            nextBlockNr++;
            nextBlock = await sourceNetworkInstance.web3.eth.getBlock(nextBlockNr);
         }

         console.log('Submit blocks', blocks[0].number, '-', blocks[blocks.length - 1].number);

         try {
            await submitHeaders(destinationNetworkConfig, destinationNetworkInstance, blocks);
         } catch (e) {
            console.log(e);
            console.log(e.message);

            nextBlockNr = nextBlockNr - blocks.length - 1;
            // mostRecentHeader = await getMostRecentBlockHash(destinationNetworkInstance.contracts.txVerifier);
            // mostRecentBlock = await sourceNetworkInstance.web3.eth.getBlock(mostRecentHeader);
            // nextBlockNr = mostRecentBlock.number + 1;
         }
      }
      else {
         await sleep(1500);
      }
   }
}

async function submitHeaders(networkConfig, networkInstance, blocks) {
   let rlpHeaders = [];
   for (let i = 0; i < blocks.length; i++) {
      rlpHeaders.push(createRLPHeader(blocks[i]));
   }

   return await callContract(
       networkConfig,
       networkConfig.accounts.submitter,
       networkInstance.web3,
       networkConfig.contracts.txVerifier.address,
       networkInstance.contracts.txVerifier.instance.methods.submitBlockBatch(RLP.encode(rlpHeaders))
   );
}