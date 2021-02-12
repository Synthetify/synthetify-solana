// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

const anchor = require('@project-serum/anchor')
const { createPriceFeed, createToken } = require('../tests/utils')
module.exports = async function (provider) {
  // Configure client to use the provider.
  anchor.setProvider(provider)
  const connection = provider.connection
  const wallet = provider.wallet.payer
  const admin = wallet
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
  collateralToken = await createToken({ connection, wallet, mintAuthority: wallet.publicKey })
  collateralAccount = await collateralToken.createAccount(mintAuthority)
  syntheticUsd = await createToken({ connection, wallet, mintAuthority })
  await systemProgram.state.rpc.initialize(
    _nonce,
    signer.publicKey,
    collateralToken.publicKey,
    collateralAccount,
    collateralTokenFeed.publicKey,
    syntheticUsd.publicKey,
    {
      accounts: {}
    }
  )
  // Add your deploy script here.
}
