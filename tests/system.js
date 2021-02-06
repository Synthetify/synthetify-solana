const anchor = require('@project-serum/anchor')
const assert = require('assert')
const { Token } = require('@solana/spl-token')
const TokenInstructions = require('@project-serum/serum').TokenInstructions

describe('system', () => {
  const provider = anchor.Provider.local()
  anchor.setProvider(provider)
  const connection = provider.connection
  const wallet = provider.wallet.payer

  const systemProgram = anchor.workspace.System
  const signer = new anchor.web3.Account()
  let collateralToken
  let mintAuthority
  let collateralAccount
  let token
  let nonce
  before(async () => {
    await systemProgram.state.rpc.new({
      accounts: {},
    })
    let [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [signer.publicKey.toBuffer()],
      systemProgram.programId
    )
    nonce = _nonce
    mintAuthority = _mintAuthority

    const collateralTokenTx = await Token.createMint(
      connection,
      wallet,
      wallet.publicKey,
      wallet.publicKey,
      8,
      TokenInstructions.TOKEN_PROGRAM_ID
    )
    collateralToken = new Token(
      connection,
      collateralTokenTx.publicKey,
      TokenInstructions.TOKEN_PROGRAM_ID,
      wallet
    )
    collateralAccount = await collateralToken.createAccount(mintAuthority)
    await collateralToken.mintTo(collateralAccount, wallet, [], 100)

    await systemProgram.state.rpc.initialize(
      _nonce,
      signer.publicKey,
      collateralToken.publicKey,
      collateralAccount,
      {
        accounts: {},
      }
    )
    const tx = await Token.createMint(
      connection,
      wallet,
      mintAuthority,
      null,
      8,
      TokenInstructions.TOKEN_PROGRAM_ID
    )
    token = new Token(connection, tx.publicKey, TokenInstructions.TOKEN_PROGRAM_ID, wallet)
  })
  beforeEach(async () => {})
  it('Check initialState', async () => {
    const state = await systemProgram.state()
    // console.log(state)
    assert.ok(state.nonce === nonce)
    assert.ok(state.initialized === true)
    assert.ok(state.signer.equals(signer.publicKey))
    assert.ok(state.collateralToken.equals(collateralToken.publicKey))
    assert.ok(state.collateralAccount.equals(collateralAccount))
    assert.ok(state.debt.eq(new anchor.BN(0)))
    assert.ok(state.shares.eq(new anchor.BN(0)))
    // initial collateralBalance
    const collateralAccountInfo = await collateralToken.getAccountInfo(collateralAccount)
    assert.ok(collateralAccountInfo.amount.eq(new anchor.BN(100)))
  })
  it('#mint()', async () => {
    const userAccount = new anchor.web3.Account()
    const userTokenAccount = await token.createAccount(userAccount.publicKey)
    const amount = new anchor.BN(100)
    await systemProgram.state.rpc.mint(amount, {
      accounts: {
        authority: mintAuthority,
        mint: token.publicKey,
        to: userTokenAccount,
        tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
      },
    })
    const info = await token.getAccountInfo(userTokenAccount)
    // console.log(info)
    assert.ok(info.amount.eq(amount))
  })
  it.only('#withdraw()', async () => {
    const userAccount = new anchor.web3.Account()
    const userCollateralTokenAccount = await collateralToken.createAccount(userAccount.publicKey)
    const amount = new anchor.BN(10)
    await systemProgram.state.rpc.withdraw(amount, {
      accounts: {
        authority: mintAuthority,
        from: collateralAccount,
        to: userCollateralTokenAccount,
        tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
      },
    })
    const info = await collateralToken.getAccountInfo(userCollateralTokenAccount)
    // console.log(info)
    assert.ok(info.amount.eq(amount))
  })

  // it('Pull data from priceFeed', async () => {
  //   await program.state.rpc.pullData({
  //     accounts: {
  //       priceFeedAccount: priceFeed.publicKey,
  //     },
  //   })
  //   const state = await program.state()
  //   assert.ok(state.price.eq(initPrice))
  //   assert.ok(state.ticker.equals(ticker))
  // })
})
