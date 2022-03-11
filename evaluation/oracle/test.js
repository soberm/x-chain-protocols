const {BaseTrie: Trie} = require("merkle-patricia-tree");
const RLP = require("rlp");
const config = require("./config.json");
const initNetwork = require("../network");
const {asyncTriePut, createRLPReceipt, createRLPTransaction, encodeToBuffer} = require("../../utils");

const failingTx = "0x876ba74805acdeff32eb507b154989e34a77a34fdaef3dd74a9fa21e5dd58485";

transactionRlp()

async function receiptRlp() {
    const networkInstance = initNetwork(config[0]);
    const receipt = await networkInstance.web3.eth.getTransactionReceipt("0x81e9cc050a90a3d57cce0316cbcfed2e3803cab2d5bbc81d30513ba1bf5e7ad8");
    const block = await networkInstance.web3.eth.getBlock(receipt.blockHash);

    const proof = await createReceiptMerkleProof(networkInstance.web3, block, receipt.transactionIndex);

    console.log((await Trie.verifyProof(
        Buffer.from(block.receiptsRoot.substring(2), "hex"),
        encodeToBuffer(receipt.transactionIndex),
        proof,
    )).toString("hex"));
}

async function transactionRlp() {
    const networkInstance = initNetwork(config[0]);
    const tx = await networkInstance.web3.eth.getTransaction(failingTx);
    const block = await networkInstance.web3.eth.getBlock(tx.blockHash);

    const proof = await createTxMerkleProof(networkInstance.web3, 4, block, tx.transactionIndex);

    console.log((await Trie.verifyProof(
        Buffer.from(block.transactionsRoot.substring(2), "hex"),
        encodeToBuffer(tx.transactionIndex),
        proof,
    )).toString("hex"));
}

const createReceiptMerkleProof = async (web3, block, transactionIndex) => {
    const trie = new Trie();

    for (let i = 0; i < block.transactions.length; i++) {
        const receipt = await web3.eth.getTransactionReceipt(block.transactions[i]);
        const rlpReceipt = createRLPReceipt(receipt);
        const key = encodeToBuffer(i);
        
        await asyncTriePut(trie, key, rlpReceipt);
    }

    const key = encodeToBuffer(transactionIndex);
    return Trie.createProof(trie, key);
};

const createTxMerkleProof = async (web3, chainId, block, transactionIndex) => {
    const trie = new Trie();
    for (let i = 0; i < block.transactions.length; i++) {
        const tx = await web3.eth.getTransaction(block.transactions[i]);

        const rlpTx = createRLPTransaction(tx, chainId);

        if (web3.utils.keccak256(`0x${rlpTx.toString("hex")}`) !== tx.hash) {
            console.log(web3.utils.keccak256(`0x${rlpTx.toString("hex")}`))
            console.log(tx.hash.substring(2))
        }

        const key = encodeToBuffer(i);

        await trie.put(key, rlpTx);
    }

    const key = encodeToBuffer(transactionIndex);
    return Trie.createProof(trie, key);
};

async function rlpTest() {
    const proof = RLP.decode(
        Uint8Array.from(Buffer.from("f90520b8b3f8b1a02f887cbe2628682baf7f1687e4ee1f2d676c56bf195dc1abfd54e56c3ca2bff7a0ad5667c2c3fbf679611ac98369f42b82ad4fb31b19d44bfd939177fef608ef96a00f4b3ff75dbab2e9f60ad4b29fbf009d2d8485401557e50aefddf77cd84b3defa02907f389e9203f0777c8ac122a33b81709901c1f92f6253607897964bdf3564980808080a06a9d8e69a5c52ded07944fda76677605d46e828c87fc0631db6869b53326fff98080808080808080b901f4f901f180a04b042270672923d3bca0d126e263d1aeb77538aa7576308737a78b1813e6f68ca0c49a4a3e259bf9b1ffbec47c14ec394c1b57a63b52e1a2496f05e36284d6e32fa01cdeb8b7abdc82b29117fe3e53537675ece9f701f473eb4c9ca133b1813a7fa4a03d0bd42d1b8e2171a9c969e0cef9171fc354c76b8b543a4a80a32c3fb276b57ea08de4b4a6b05f59bec1be32aad614022c61e87dbd6fae8ba5f5521a43153a5a3fa09bc6ea28e4b65bc6e7a741b844499e1cfe8fdc2045c0d28673f88b252d6f3e90a01b6a09060157eb1c02df69af382bd7ca3951b42611d85ec4da10e78415c3757ba0a846cb6fda6ea688a771b4a8c3f84b2df74d33195c21aa80cf1b4d6443d3c84aa05d9a2ca36411b7a3199fb6dd4956d0c112f7c5f2a5b61ae2fb658621d25b2739a09ef379f7920c51f8bb86a400ca758464300904df54b62c1518d179bdf3bc73bba0b8a7d941e5c3b661306ed179eb78a4e6c507eb4b3e0cf846a732a3edf0765c48a09f35ff7d86d3ef7ca15a0f23fde47649dc61f4d25903b29c830c0ab7f0d33d74a0691d67a15c43c107beb36e626fdf29a433e771aabeb4d50f42433d368e0906dea0ee78b614a7ef1b73576ad0ba09c007205e010660bfa6f79aa9f32e9c7de80af5a0786b35bb22f0060a240810ce2a2ff9acae27b1d03d9240e274a517d6d4a9357880b90271f9026e20b9026a02f90266018305330ab9010000000000000000000000000000000000000080000000000000000000000008000000000000000000000000000000000000000000000000002000000000000000000040000000000000000008000000000000000000000000000000000000000020800000020000000000000000000800000000000000000000000010000000000010000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000400400000000000000000000000000002000000002000000000000000000000000000000000000000000020000000000000000000008000000002000000400000000040000000000000000000f9015bf89b942be6fe6b955c3253a4777c3f9a36572ca58f6ba1f863a0ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3efa00000000000000000000000009b94c72ce65e892d30ab3640bba108ed94b430e2a00000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001f8bc942be6fe6b955c3253a4777c3f9a36572ca58f6ba1f884a0f8a861f822ed8ac8743e429937c8bb8952ca8617a40319ef7fde892039aac128a00000000000000000000000009b94c72ce65e892d30ab3640bba108ed94b430e2a0000000000000000000000000c36826da92b8feacd892de3eae1261a4ece608f0a0000000000000000000000000b680ea3948ed206c686bad2bbc13469072d23c84a00000000000000000000000000000000000000000000000000000000000000001", 'hex'))
    ).map(buf => Buffer.from(buf));
    // console.log(raw.toString("hex"))
    console.log((await Trie.verifyProof(
        Buffer.from("7b2a486135286c985dc0cd67a91ce5a8d71e4190ffc006454567f343f43e0071", "hex"),
        Buffer.from("02", "hex"),
        proof,
    )).toString("hex"));
}