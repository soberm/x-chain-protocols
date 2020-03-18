const fs = require('fs');
const Web3 = require('web3');

const initNetwork = (networkConfig) => {
    const web3 = new Web3(new Web3.providers.WebsocketProvider(networkConfig.url));

    // create contract object for TxInclusionVerifier
    let jsonFileContent = fs.readFileSync(networkConfig.contracts.txVerifier.file);
    let parsedJson = JSON.parse(jsonFileContent);
    const txVerifierBytecode = parsedJson.bytecode;
    const txVerifierInstance = new web3.eth.Contract(parsedJson.abi);
    const txVerifierName = networkConfig.contracts.txVerifier.file.substring(
        networkConfig.contracts.txVerifier.file.lastIndexOf("/") + 1,
        networkConfig.contracts.txVerifier.file.lastIndexOf(".")
    );

    // create contract object for Protocol2
    jsonFileContent = fs.readFileSync(networkConfig.contracts.protocol.file);
    parsedJson = JSON.parse(jsonFileContent);
    const protocolBytecode = parsedJson.bytecode;
    const protocolInstance = new web3.eth.Contract(parsedJson.abi);
    const protocolName = networkConfig.contracts.protocol.file.substring(
        networkConfig.contracts.protocol.file.lastIndexOf("/") + 1,
        networkConfig.contracts.protocol.file.lastIndexOf(".")
    );

    return {
        web3: web3,
        contracts: {
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

const callContract = async (networkConfig, web3, contractAddr, method) => {
    console.log('Call function', method._method.name, 'on', networkConfig.name);

    let txCount = await web3.eth.getTransactionCount(networkConfig.account.address);
    let tx = {
        from: networkConfig.account.address,
        to: contractAddr,
        gasLimit: 1000000,
        gasPrice: web3.utils.toHex(await web3.eth.getGasPrice()),
        nonce: web3.utils.toHex(txCount),
        value: '0x0',
        data: method.encodeABI(),
        chainId: networkConfig.chainId
    };
    let signedTx = await web3.eth.accounts.signTransaction(tx, networkConfig.account.privateKey);
    let txReceipt = undefined;
    await web3.eth.sendSignedTransaction(signedTx.raw || signedTx.rawTransaction)
        .on("receipt", receipt => {
            console.log('Transaction Hash:', receipt.transactionHash);
            txReceipt = receipt;
        })
        .on("error", err => {
            console.log(err);
        });

    return txReceipt;
};

module.exports = {
    initNetwork,
    callContract
};