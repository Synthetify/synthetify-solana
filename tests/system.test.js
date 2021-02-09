const anchor = require('@project-serum/anchor')
const assert = require('assert')
const TokenInstructions = require('@project-serum/serum').TokenInstructions
const { createToken, createAccountWithCollateral, createPriceFeed } = require('./utils')

describe('system', () => {
  const provider = anchor.Provider.local()
  anchor.setProvider(provider)
  const connection = provider.connection
  const wallet = provider.wallet.payer
  const admin = wallet
  const systemProgram = anchor.workspace.System
  const oracleProgram = anchor.workspace.Oracle
  const signer = new anchor.web3.Account()
  let collateralToken
  let mintAuthority
  let collateralAccount
  let syntheticUsd
  let nonce
  let collateralTokenFeed
  const initPrice = new anchor.BN(2 * 1e4)
  const ticker = Buffer.from('SNY', 'utf-8')
  before(async () => {
    await systemProgram.state.rpc.new({
      accounts: {}
    })
    const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [signer.publicKey.toBuffer()],
      systemProgram.programId
    )
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
    // initaly we will have collateral and sythetic usd
    assert.ok(state.assets.length === 2)
    assert.ok(state.assets[0].price.eq(new anchor.BN(1e4)))
    assert.ok(state.assets[0].assetAddress.equals(syntheticUsd.publicKey))
    // initial collateralBalance
    const collateralAccountInfo = await collateralToken.getAccountInfo(collateralAccount)
    assert.ok(collateralAccountInfo.amount.eq(new anchor.BN(0)))
  })
  it('#deposit()', async () => {
    const userWallet = new anchor.web3.Account()
    const userAccount = new anchor.web3.Account()
    await systemProgram.rpc.createUserAccount(userWallet.publicKey, {
      accounts: {
        userAccount: userAccount.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY
      },
      signers: [userAccount],
      // Auto allocate memory
      instructions: [await systemProgram.account.userAccount.createInstruction(userAccount)]
    })
    const account = await systemProgram.account.userAccount(userAccount.publicKey)
    assert.ok(account.shares.eq(new anchor.BN(0)))
    assert.ok(account.collateral.eq(new anchor.BN(0)))
    assert.ok(account.owner.equals(userWallet.publicKey))
    const userCollateralTokenAccount = await collateralToken.createAccount(userAccount.publicKey)
    const amount = new anchor.BN(10)
    await collateralToken.mintTo(userCollateralTokenAccount, wallet, [], amount.toNumber())

    const userCollateralTokenAccountInfo = await collateralToken.getAccountInfo(
      userCollateralTokenAccount
    )
    assert.ok(userCollateralTokenAccountInfo.amount.eq(amount))
    await systemProgram.state.rpc.deposit({
      accounts: {
        userAccount: userAccount.publicKey,
        collateralAccount: collateralAccount
      },
      instructions: [
        await collateralToken.transfer(
          userCollateralTokenAccount,
          collateralAccount,
          userAccount,
          [],
          amount.toNumber()
        )
      ]
    })
    const collateralAccountInfo = await collateralToken.getAccountInfo(collateralAccount)
    assert.ok(collateralAccountInfo.amount.eq(amount))
    const accountAfterDeposit = await systemProgram.account.userAccount(userAccount.publicKey)
    assert.ok(accountAfterDeposit.shares.eq(new anchor.BN(0)))
    assert.ok(accountAfterDeposit.collateral.eq(amount))
    assert.ok(accountAfterDeposit.owner.equals(userWallet.publicKey))
  })
  it('#updatePrice()', async () => {
    await systemProgram.state.rpc.updatePrice(collateralTokenFeed.publicKey, {
      accounts: {
        priceFeedAccount: collateralTokenFeed.publicKey,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY
      }
    })
    const state = await systemProgram.state()
    // collateral will always have index 1
    assert.ok(state.assets[1].price.eq(initPrice))
  })
  it('#mint()', async () => {
    const { userSystemAccount } = await createAccountWithCollateral({
      collateralAccount,
      collateralToken,
      mintAuthority: wallet,
      systemProgram,
      amount: new anchor.BN(100 * 1e8)
    })
    const userTokenAccount = await syntheticUsd.createAccount(userSystemAccount.publicKey)
    const amount = new anchor.BN(1 * 1e8)
    await systemProgram.state.rpc.mint(amount, {
      accounts: {
        authority: mintAuthority,
        mint: syntheticUsd.publicKey,
        to: userTokenAccount,
        tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        userAccount: userSystemAccount.publicKey
      },
      instructions: [
        await systemProgram.state.rpc.updatePrice(collateralTokenFeed.publicKey, {
          accounts: {
            priceFeedAccount: collateralTokenFeed.publicKey,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY
          }
        })
      ]
    })
    const info = await syntheticUsd.getAccountInfo(userTokenAccount)
    assert.ok(info.amount.eq(amount))
    const account = await systemProgram.account.userAccount(userSystemAccount.publicKey)
    assert.ok(account.shares.eq(new anchor.BN(1e8))) // Its first mint so shares will be 1e8
    const state = await systemProgram.state()
    assert.ok(state.shares.eq(new anchor.BN(1e8))) // Its first mint so shares will be 1e8
  })
  it('#addAsset()', async () => {
    const newToken = await createToken({ connection, mintAuthority, wallet })
    // TODO: Create and Add price feed to this new token
    await systemProgram.state.rpc.addAsset({
      accounts: {
        assetAddress: newToken.publicKey,
        feedAddress: newToken.publicKey
      }
    })
    const state = await systemProgram.state()
    assert.ok(state.assets.length === 3)
    assert.ok(state.assets[2].feedAddress.equals(newToken.publicKey))
    assert.ok(state.assets[2].assetAddress.equals(newToken.publicKey))
  })

  it('#widthdraw()', async () => {
    const userAccount = new anchor.web3.Account()
    const userCollateralTokenAccount = await collateralToken.createAccount(userAccount.publicKey)
    const amount = new anchor.BN(10)
    await collateralToken.mintTo(collateralAccount, wallet, [], 10)
    await systemProgram.state.rpc.withdraw(amount, {
      accounts: {
        authority: mintAuthority,
        from: collateralAccount,
        to: userCollateralTokenAccount,
        tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID
      }
    })
    const info = await collateralToken.getAccountInfo(userCollateralTokenAccount)
    // console.log(info)
    assert.ok(info.amount.eq(amount))
  })

  it('#createUserAccount()', async () => {
    const userWallet = new anchor.web3.Account()
    const userAccount = new anchor.web3.Account()
    await systemProgram.rpc.createUserAccount(userWallet.publicKey, {
      accounts: {
        userAccount: userAccount.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY
      },
      signers: [userAccount],
      // Auto allocate memory
      instructions: [await systemProgram.account.userAccount.createInstruction(userAccount)]
    })
    const account = await systemProgram.account.userAccount(userAccount.publicKey)
    assert.ok(account.shares.eq(new anchor.BN(0)))
    assert.ok(account.collateral.eq(new anchor.BN(0)))
    assert.ok(account.owner.equals(userWallet.publicKey))
  })
})
