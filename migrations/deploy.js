// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

const anchor = require('@project-serum/anchor')
const { createPriceFeed, createToken } = require('../tests/utils')
const admin = require('./testAdmin')
const initialTokens = [
  { price: new anchor.BN(40 * 1e4), ticker: Buffer.from('xFTT') },
  { price: new anchor.BN(50000 * 1e4), ticker: Buffer.from('xBTC') },
  { price: new anchor.BN(12 * 1e4), ticker: Buffer.from('xSOL') },
  { price: new anchor.BN(5 * 1e4), ticker: Buffer.from('xSRM') },
  { price: new anchor.BN(2000 * 1e4), ticker: Buffer.from('xETH') },
  { price: new anchor.BN(25 * 1e4), ticker: Buffer.from('xLINK') },
  { price: new anchor.BN(300 * 1e4), ticker: Buffer.from('xBNB') }
]
module.exports = async function () {
  // Configure client to use the provider.
  const provider = anchor.Provider.local('https://devnet.solana.com', {
    commitment: 'singleGossip',
    // preflightCommitment: 'max',
    skipPreflight: true
  })
  anchor.setProvider(provider)
  const connection = provider.connection
  const wallet = provider.wallet.payer
  console.log(wallet.publicKey.toString())
  const systemProgram = anchor.workspace.System
  const oracleProgram = anchor.workspace.Oracle
  const signer = new anchor.web3.Account()
  const initPrice = new anchor.BN(2 * 1e4)
  const ticker = Buffer.from('SNY', 'utf-8')
  await systemProgram.state.rpc.new({
    accounts: {}
  })
  const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
    [signer.publicKey.toBuffer()],
    systemProgram.programId
  )
  let collateralToken
  let mintAuthority
  let collateralAccount
  let syntheticUsd
  let nonce
  let collateralTokenFeed
  nonce = _nonce
  mintAuthority = _mintAuthority
  collateralTokenFeed = await createPriceFeed({ admin, oracleProgram, initPrice, ticker })
  collateralToken = await createToken({ connection, wallet, mintAuthority: admin.publicKey })
  collateralAccount = await collateralToken.createAccount(mintAuthority)
  syntheticUsd = await createToken({ connection, wallet, mintAuthority })
  console.log(mintAuthority)
  await systemProgram.state.rpc.initialize(
    _nonce,
    signer.publicKey,
    wallet.publicKey,
    collateralToken.publicKey,
    collateralAccount,
    collateralTokenFeed.publicKey,
    syntheticUsd.publicKey,
    mintAuthority,
    {
      accounts: {}
    }
  )
  for (const tokenData of initialTokens) {
    const newToken = await createToken({ connection, mintAuthority: mintAuthority, wallet })
    const tokenFeed = await createPriceFeed({
      admin: wallet,
      oracleProgram,
      initPrice: tokenData.price,
      ticker: tokenData.ticker
    })

    await systemProgram.state.rpc.addAsset(tokenData.ticker, {
      accounts: {
        assetAddress: newToken.publicKey,
        feedAddress: tokenFeed.publicKey,
        admin: wallet.publicKey
      },
      signer: [wallet]
    })
    console.log(`deployed ${tokenData.ticker.toString()}`)
  }
  const state = await systemProgram.state()
  console.log(state)
}
