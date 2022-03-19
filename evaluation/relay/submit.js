const {createRLPHeader, encodeToBuffer} = require("../../utils");
const {callContract, sleep} = require("../common");
const {getMostRecentBlockHash} = require("./common");
const initNetwork = require("../network");
const config = require("./config");
const RLP = require("rlp");
const process = require("process");

const HEADER_BATCH_SIZE = 25;

const sourceNetworkName = process.argv[2];
let sourceNetworkConfig;
let sourceNetworkInstance;
let destinationNetworkConfig;
let destinationNetworkInstance;
const [config0, config1] = [config[0], config[1]];
const [network0Instance, network1Instance] = [initNetwork(config0), initNetwork(config1)];

if (sourceNetworkName === "rinkeby") {
   sourceNetworkConfig = config0;
   sourceNetworkInstance = network0Instance;
   destinationNetworkConfig = config1;
   destinationNetworkInstance = network1Instance;
} else if (sourceNetworkName === "ropsten") {
   sourceNetworkConfig = config1;
   sourceNetworkInstance = network1Instance;
   destinationNetworkConfig = config0;
   destinationNetworkInstance = network0Instance;
} else {
   console.error("Invalid network name")
   process.exit(1);
}

(async () => {
   console.log("Relay Headers from", sourceNetworkConfig.name, "to", destinationNetworkConfig.name, "...");

   let mostRecentHeader = await getMostRecentBlockHash(destinationNetworkInstance.contracts.relay, destinationNetworkConfig.accounts.submitter.address);
   let mostRecentBlock = await sourceNetworkInstance.web3.eth.getBlock(mostRecentHeader);
   let nextBlockNr = mostRecentBlock.number + 1;

   while(true) {
      console.log("Next batch starts at block number", nextBlockNr);

      let blocks = [];
      // TODO Use web3.eth.subscribe("newBlockHeaders")
      let nextBlock = await sourceNetworkInstance.web3.eth.getBlock(nextBlockNr);

      if (nextBlock !== null) {
         let storedWithinRelay = await isHeaderStored(destinationNetworkInstance.contracts.relay, nextBlock.hash);

         // check if next block is already stored within relay
         if (storedWithinRelay === true) {
            nextBlockNr++;
            continue;
         }

         // check if parent is stored within relay
         storedWithinRelay = await isHeaderStored(destinationNetworkInstance.contracts.relay, nextBlock.parentHash);
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

         console.log("Submit blocks", blocks[0].number, "-", blocks[blocks.length - 1].number);

         try {
            await submitHeaders(destinationNetworkConfig, destinationNetworkInstance, blocks);
         } catch (e) {
            console.log(e);
            console.log(e.message);

            nextBlockNr = nextBlockNr - blocks.length - 1;
            // mostRecentHeader = await getMostRecentBlockHash(destinationNetworkInstance.contracts.relay);
            // mostRecentBlock = await sourceNetworkInstance.web3.eth.getBlock(mostRecentHeader);
            // nextBlockNr = mostRecentBlock.number + 1;
         }
      }
      else {
         await sleep(1500);
      }
   }
})();

function submitHeaders(networkConfig, networkInstance, blocks) {
   const rlpHeaders = blocks.map(block => createRLPHeader(block));

   return callContract(
      networkConfig.name,
      networkInstance.contracts.relay.instance.methods.submitBlockBatch(encodeToBuffer(rlpHeaders)),
      networkConfig.accounts.submitter.address,
   );
}

const isHeaderStored = (relayContract, blockHash) => {
   return relayContract.instance.methods.isHeaderStored(blockHash).call();
};
