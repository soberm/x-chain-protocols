const {createRLPHeader, encodeToBuffer} = require("../../utils");
const {callContract} = require("../common");
const initNetwork = require("../network");
const config = require("./config");
const process = require("process");

const HEADER_BATCH_SIZE = 25;
const MAX_BACKWARDS_STEPS = 100;

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
   console.log(`Relay headers from ${sourceNetworkConfig.name} to ${destinationNetworkConfig.name}...`);

   let nextBlockNr = await getNextBlockNumberInRelay();
   let backwardsSteps = 0;

   const blockWatcher = new BlockWatcher(sourceNetworkInstance.web3, await sourceNetworkInstance.web3.eth.getBlockNumber());

   while(true) {
      if (backwardsSteps >= MAX_BACKWARDS_STEPS) {
         nextBlockNr = await getNextBlockNumberInRelay();
         backwardsSteps = 0;
      }

      console.log(`Next batch starts at block number ${nextBlockNr}`);

      const blocks = [await blockWatcher.waitForBlock(nextBlockNr++)];

      for (; nextBlockNr <= blockWatcher.mostRecentBlockNumber && blocks.length < HEADER_BATCH_SIZE; nextBlockNr++) {
         const nextBlock = await sourceNetworkInstance.web3.eth.getBlock(nextBlockNr);
         blocks.push(nextBlock);
      }

      console.log(`Submit blocks ${blocks[0].number} - ${blocks[blocks.length - 1].number}`);

      try {
         await submitHeaders(destinationNetworkConfig, destinationNetworkInstance, blocks);
         backwardsSteps = 0;
      } catch (err) {
         console.error(err.message);
         nextBlockNr = nextBlockNr - blocks.length - 1;
         backwardsSteps++;
      }
   }
})();

async function getNextBlockNumberInRelay() {
   const header = await destinationNetworkInstance.contracts.relay.instance.methods.getLongestChainEndpoint().call({
      "from": destinationNetworkConfig.accounts.submitter.address
   });

   return (await sourceNetworkInstance.web3.eth.getBlock(header)).number + 1;
}

function submitHeaders(networkConfig, networkInstance, blocks) {
   const rlpHeaders = blocks.map(block => createRLPHeader(block));

   return callContract(
      networkConfig.name,
      networkInstance.contracts.relay.instance.methods.submitBlockBatch(encodeToBuffer(rlpHeaders)),
      networkConfig.accounts.submitter.address,
   );
}

class BlockWatcher {
   constructor(web3, mostRecentBlockNumber) {
      this.web3 = web3;
      this.mostRecentBlockNumber = mostRecentBlockNumber;
      this.awaitedBlock = {
         "number": Infinity,
         "callback": null,
      };

      this.web3.eth.subscribe("newBlockHeaders", (err, header) => {
         if (err !== null) {
            console.error(err);
            return;
         }

         this.mostRecentBlockNumber = header.number;

         if (this.mostRecentBlockNumber >= this.awaitedBlock.number) {
            this.awaitedBlock.callback(header);

            this._awaitBlock(Infinity, null);
         }
      });
   }

   waitForBlock(blockNumber) {
      if (this.mostRecentBlockNumber >= blockNumber) {
         return this.web3.eth.getBlock(blockNumber);
      }

      return new Promise(resolve => {
         this._awaitBlock(blockNumber, resolve);
      });
   }

   _awaitBlock(blockNumber, callback) {
      this.awaitedBlock.number = blockNumber;
      this.awaitedBlock.callback = callback;
   }
}
