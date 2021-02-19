// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

const anchor = require('@project-serum/anchor')
const { PublicKey, Account } = require('@solana/web3.js')
const { createPriceFeed, createToken, newAccountWithLamports } = require('../tests/utils')
const main = async () => {
  const provider = anchor.Provider.local('https://devnet.solana.com')
  const oracleIdl = JSON.parse(require('fs').readFileSync('./target/idl/oracle.json', 'utf8'))
  const systemIdl = JSON.parse(require('fs').readFileSync('./target/idl/system.json', 'utf8'))
  const oracleAddress = new anchor.web3.PublicKey('65Yx3tYiJqbKW8VatPSmDBB2b4tENTQqj15wBT3MtAXh')
  const systemAddress = new anchor.web3.PublicKey('4RnVyXHhr9ddNTkgNsQSHQ34TFdsaUNjzMVyh84Sw9Pd')
  // Configure client to use the provider.
  anchor.setProvider(provider)
  const connection = provider.connection
  const wallet = provider.wallet.payer
  const admin = wallet
  console.log(wallet.publicKey.toString())
  const systemProgram = new anchor.Program(systemIdl, systemAddress)
  // console.log(acc.secretKey.toString())
  // await connection.requestAirdrop(acc.publicKey, 1e10)
  // await connection.requestAirdrop(acc.publicKey, 1e10)
  // await connection.requestAirdrop(acc.publicKey, 1e10)
  const oracleProgram = new anchor.Program(oracleIdl, oracleAddress)
  const state = await systemProgram.state()
  // const userAccount = new anchor.web3.Account()
  // console.log(await systemProgram.account.userAccount.createInstruction(userAccount))
  // const signer = new anchor.web3.Account()
  // const initPrice = new anchor.BN(2 * 1e4)
  // const ticker = Buffer.from('SNY', 'utf-8')
  // await systemProgram.state.rpc.new({
  //   accounts: {}
  // })
  // const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
  //   [signer.publicKey.toBuffer()],
  //   systemProgram.programId
  // )
  // let collateralToken
  // let mintAuthority
  // let collateralAccount
  // let syntheticUsd
  // let nonce
  // let collateralTokenFeed
  // nonce = _nonce
  // mintAuthority = _mintAuthority
  // collateralTokenFeed = await createPriceFeed({ admin, oracleProgram, initPrice, ticker })
  // collateralToken = await createToken({ connection, wallet, mintAuthority: admin.publicKey })
  // collateralAccount = await collateralToken.createAccount(mintAuthority)
  // syntheticUsd = await createToken({ connection, wallet, mintAuthority })
  // await systemProgram.state.rpc.initialize(
  //   _nonce,
  //   signer.publicKey,
  //   wallet.publicKey,
  //   collateralToken.publicKey,
  //   collateralAccount,
  //   collateralTokenFeed.publicKey,
  //   syntheticUsd.publicKey,
  //   {
  //     accounts: {}
  //   }
  // )
  console.log(state)
}
main()
