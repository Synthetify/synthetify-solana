// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

const anchor = require('@project-serum/anchor')
const { createPriceFeed, createToken } = require('../tests/utils')
const main = async () => {
  const provider = anchor.Provider.local('https://testnet.solana.com')
  const oracleIdl = JSON.parse(require('fs').readFileSync('./target/idl/oracle.json', 'utf8'))
  const systemIdl = JSON.parse(require('fs').readFileSync('./target/idl/system.json', 'utf8'))
  const oracleAddress = new anchor.web3.PublicKey('C428JakvgvTu5hnzFSEiLRCxRcij22DcTRx5jczwdQhp')
  const systemAddress = new anchor.web3.PublicKey('4dZnVVf6d4Tm2Q7U3BVncEL4camgfuy4T5fx5XE4U8DC')
  // Configure client to use the provider.
  anchor.setProvider(provider)
  const connection = provider.connection
  const wallet = provider.wallet.payer
  const admin = wallet
  console.log(wallet.publicKey.toString())
  const systemProgram = new anchor.Program(systemIdl, systemAddress)
  const oracleProgram = new anchor.Program(oracleIdl, oracleAddress)
  const state = await systemProgram.state()
  console.log(state)
}
main()
