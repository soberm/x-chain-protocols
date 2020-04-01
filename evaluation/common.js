const fs = require('fs');
const Web3 = require('web3');

const initNetwork = (networkConfig) => {
    // const web3 = new Web3(new Web3.providers.WebsocketProvider(networkConfig.url));
    const web3 = new Web3(networkConfig.url);

    // create contract object for Ethash
    let jsonFileContent = fs.readFileSync(networkConfig.contracts.ethash.file);
    let parsedJson = JSON.parse(jsonFileContent);
    const ethashBytecode = parsedJson.bytecode;
    const ethashInstance = new web3.eth.Contract(parsedJson.abi);
    if (networkConfig.contracts.ethash.address !== undefined && networkConfig.contracts.ethash.address !== '') {
        ethashInstance.options.address = networkConfig.contracts.ethash.address;
    }
    const ethashName = networkConfig.contracts.ethash.file.substring(
        networkConfig.contracts.ethash.file.lastIndexOf("/") + 1,
        networkConfig.contracts.ethash.file.lastIndexOf(".")
    );

    // create contract object for TxInclusionVerifier
    jsonFileContent = fs.readFileSync(networkConfig.contracts.txVerifier.file);
    parsedJson = JSON.parse(jsonFileContent);
    const txVerifierBytecode = parsedJson.bytecode;
    const txVerifierInstance = new web3.eth.Contract(parsedJson.abi);
    if (networkConfig.contracts.txVerifier.address !== undefined && networkConfig.contracts.txVerifier.address !== '') {
        txVerifierInstance.options.address = networkConfig.contracts.txVerifier.address;
    }
    const txVerifierName = networkConfig.contracts.txVerifier.file.substring(
        networkConfig.contracts.txVerifier.file.lastIndexOf("/") + 1,
        networkConfig.contracts.txVerifier.file.lastIndexOf(".")
    );

    // create contract object for Protocol2
    jsonFileContent = fs.readFileSync(networkConfig.contracts.protocol.file);
    parsedJson = JSON.parse(jsonFileContent);
    const protocolBytecode = parsedJson.bytecode;
    const protocolInstance = new web3.eth.Contract(parsedJson.abi);
    if (networkConfig.contracts.protocol.address !== undefined && networkConfig.contracts.protocol.address !== '') {
        protocolInstance.options.address = networkConfig.contracts.protocol.address;
    }
    const protocolName = networkConfig.contracts.protocol.file.substring(
        networkConfig.contracts.protocol.file.lastIndexOf("/") + 1,
        networkConfig.contracts.protocol.file.lastIndexOf(".")
    );

    return {
        web3: web3,
        contracts: {
            ethash: {
                name: ethashName,
                bytecode: ethashBytecode,
                instance: ethashInstance
            },
            txVerifier: {
                name: txVerifierName,
                bytecode: txVerifierBytecode,
                instance: txVerifierInstance
            },
            protocol: {
                name: protocolName,
                bytecode: protocolBytecode,
                instance: protocolInstance
            }
        }
    }
};

const callContract = async (networkConfig, account, web3, contractAddr, method) => {
    console.log('Call function', method._method.name, 'on', networkConfig.name);

    let medianGasPrice = parseInt(await web3.eth.getGasPrice());
    let txCount = await web3.eth.getTransactionCount(account.address);
    let tx = {
        from: account.address,
        to: contractAddr,
        gasLimit: 7000000,
        gasPrice: web3.utils.toHex(Math.ceil( medianGasPrice * 1.5)),
        nonce: web3.utils.toHex(txCount),
        value: '0x0',
        data: method.encodeABI(),
        chainId: networkConfig.chainId
    };
    let signedTx = await web3.eth.accounts.signTransaction(tx, account.privateKey);
    let txReceipt = await web3.eth.sendSignedTransaction(signedTx.raw || signedTx.rawTransaction);
    console.log('Transaction Hash:', txReceipt.transactionHash);

    return txReceipt;
};

const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * @returns the hash of the most recent block of the main chain stored within the relay running on the specified blockchain.
 */
const getMostRecentBlockHash = async (relayContract) =>  {
    return await relayContract.instance.methods.longestChainEndpoint().call();
};

const getHeaderInfo = async (relayContract, blockHash) => {
    return await relayContract.instance.methods.getHeader(blockHash).call();
};

const isHeaderStored = async (relayContract, blockHash) => {
    return await relayContract.instance.methods.isHeaderStored(blockHash).call();
};

module.exports = {
    initNetwork,
    callContract,
    sleep,
    getMostRecentBlockHash,
    getHeaderInfo,
    isHeaderStored
};