// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

const anchor = require('@project-serum/anchor')
const { PublicKey, Account } = require('@solana/web3.js')
const { createPriceFeed, createToken, newAccountWithLamports } = require('../tests/utils')
const admin = require('../migrations/testAdmin')

const main = async () => {
  const provider = anchor.Provider.local('https://devnet.solana.com', {
    commitment: 'max',
    preflightCommitment: 'max',
    skipPreflight: true
  })
  const oracleIdl = JSON.parse(require('fs').readFileSync('./target/idl/oracle.json', 'utf8'))
  const systemIdl = JSON.parse(require('fs').readFileSync('./target/idl/system.json', 'utf8'))
  const oracleAddress = new anchor.web3.PublicKey('65Yx3tYiJqbKW8VatPSmDBB2b4tENTQqj15wBT3MtAXh')
  const systemAddress = new anchor.web3.PublicKey('4RnVyXHhr9ddNTkgNsQSHQ34TFdsaUNjzMVyh84Sw9Pd')
  // Configure client to use the provider.
  anchor.setProvider(provider)
  const connection = provider.connection
  const wallet = provider.wallet.payer
  // const admin = wallet
  console.log(wallet.publicKey.toString())
  const systemProgram = new anchor.Program(systemIdl, systemAddress)
  // console.log(acc.secretKey.toString())
  // await connection.requestAirdrop(acc.publicKey, 1e10)
  // await connection.requestAirdrop(acc.publicKey, 1e10)
  // await connection.requestAirdrop(acc.publicKey, 1e10)
  const oracleProgram = new anchor.Program(oracleIdl, oracleAddress)
  const state = await systemProgram.state()
  console.log(state.mintAuthority.toString())
  const newToken = await createToken({ connection, mintAuthority: state.mintAuthority, wallet })
  // console.log(newToken)
  const tokenFeed = await createPriceFeed({
    admin,
    oracleProgram,
    initPrice: new anchor.BN(40 * 1e4),
    ticker: Buffer.from('xFTT')
  })
  console.log(tokenFeed.publicKey.toString())

  await systemProgram.state.rpc.addAsset(Buffer.from('xFTT'), {
    accounts: {
      assetAddress: newToken.publicKey,
      feedAddress: tokenFeed.publicKey,
      admin: wallet.publicKey
    },
    signer: [wallet]
  })
  const state2 = await systemProgram.state()
  console.log(state2)
}
main()
