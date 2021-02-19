// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

const anchor = require('@project-serum/anchor')
const { PublicKey, Account } = require('@solana/web3.js')
const { createPriceFeed, createToken, newAccountWithLamports } = require('../tests/utils')
const admin = require('../migrations/testAdmin')

const main = async () => {
  const provider = anchor.Provider.local('https://devnet.solana.com', {
    commitment: 'singleGossip',
    preflightCommitment: 'singleGossip',
    skipPreflight: true
  })
  const oracleIdl = JSON.parse(require('fs').readFileSync('./target/idl/oracle.json', 'utf8'))
  const oracleAddress = new anchor.web3.PublicKey('65Yx3tYiJqbKW8VatPSmDBB2b4tENTQqj15wBT3MtAXh')
  // Configure client to use the provider.
  anchor.setProvider(provider)
  const connection = provider.connection
  const wallet = provider.wallet.payer
  // const admin = wallet
  // console.log(wallet.publicKey.toString())
  const oracleProgram = new anchor.Program(oracleIdl, oracleAddress)
  const newPrice = new anchor.BN(40 * 1e4)
  const a = await oracleProgram.rpc.setPrice(newPrice, {
    accounts: {
      priceFeed: new PublicKey('Gc6V98AKUCZEb4WhzZdnLim6LVSjbqbsM7mUnLYe4gPi'),
      admin: admin.publicKey
    },
    signers: [admin]
  })
  console.log(a)
}
main()
