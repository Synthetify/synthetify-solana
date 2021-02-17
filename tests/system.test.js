/* eslint-disable new-cap */
const anchor = require('@project-serum/anchor')
const assert = require('assert')
const TokenInstructions = require('@project-serum/serum').TokenInstructions
const { u64, Token } = require('@solana/spl-token')

const {
  createToken,
  createAccountWithCollateral,
  createPriceFeed,
  mintUsd,
  updateAllFeeds,
  tou64,
  newAccountWithLamports
} = require('./utils')

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
  })
  beforeEach(async () => {})
  it('Check initialState', async () => {
    const state = await systemProgram.state()
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
    const userWallet = await newAccountWithLamports(systemProgram.provider.connection)
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
    const userCollateralTokenAccount = await collateralToken.createAccount(userWallet.publicKey)
    const amount = new anchor.BN(10)
    await collateralToken.mintTo(userCollateralTokenAccount, wallet, [], tou64(amount))

    const userCollateralTokenAccountInfo = await collateralToken.getAccountInfo(
      userCollateralTokenAccount
    )
    assert.ok(userCollateralTokenAccountInfo.amount.eq(amount))
    await systemProgram.state.rpc.deposit({
      accounts: {
        userAccount: userAccount.publicKey,
        collateralAccount: collateralAccount
      },
      signers: [userWallet],
      instructions: [
        Token.createTransferInstruction(
          collateralToken.programId,
          userCollateralTokenAccount,
          collateralAccount,
          userWallet.publicKey,
          [],
          tou64(amount.toString())
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
  describe('#mint()', () => {
    const firstMintAmount = new anchor.BN(1 * 1e7)
    const firstMintShares = new anchor.BN(1 * 1e8)
    it('1st mint', async () => {
      const { userSystemAccount, userWallet } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        mintAuthority: wallet,
        systemProgram,
        amount: new anchor.BN(100 * 1e8)
      })
      const userTokenAccount = await syntheticUsd.createAccount(userWallet.publicKey)
      await mintUsd({
        userWallet,
        systemProgram,
        userSystemAccount,
        userTokenAccount,
        mintAuthority,
        mintAmount: firstMintAmount
      })
      const info = await syntheticUsd.getAccountInfo(userTokenAccount)
      assert.ok(info.amount.eq(firstMintAmount))
      const account = await systemProgram.account.userAccount(userSystemAccount.publicKey)
      assert.ok(account.shares.eq(firstMintShares)) // Its first mint so shares will be 1e8
      const state = await systemProgram.state()
      assert.ok(state.shares.eq(firstMintShares)) // Its first mint so shares will be 1e8
    })
    it('2nd mint', async () => {
      const { userSystemAccount, userWallet } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        mintAuthority: wallet,
        systemProgram,
        amount: new anchor.BN(100 * 1e8)
      })

      const userTokenAccount = await syntheticUsd.createAccount(userSystemAccount.publicKey)
      // We mint same amount
      await mintUsd({
        userWallet,
        systemProgram,
        userSystemAccount,
        userTokenAccount,
        mintAuthority,
        mintAmount: firstMintAmount
      })
      const info = await syntheticUsd.getAccountInfo(userTokenAccount)
      assert.ok(info.amount.eq(firstMintAmount))
      const account = await systemProgram.account.userAccount(userSystemAccount.publicKey)
      assert.ok(account.shares.eq(firstMintShares)) // we minted same amount so shares should be equal
      const state = await systemProgram.state()
      assert.ok(state.shares.eq(firstMintShares.mul(new anchor.BN(2)))) // Shares should double
    })
    it('3rd mint', async () => {
      const mintAmount = firstMintAmount.div(new anchor.BN(3)) // Mint 1/3
      const { userSystemAccount, userWallet } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        mintAuthority: wallet,
        systemProgram,
        amount: new anchor.BN(100 * 1e8)
      })
      const userTokenAccount = await syntheticUsd.createAccount(userSystemAccount.publicKey)
      // We mint same amount
      await mintUsd({
        userWallet,
        systemProgram,
        userSystemAccount,
        userTokenAccount,
        mintAuthority,
        mintAmount: mintAmount
      })
      const info = await syntheticUsd.getAccountInfo(userTokenAccount)
      assert.ok(info.amount.eq(mintAmount))
      const account = await systemProgram.account.userAccount(userSystemAccount.publicKey)
      assert.ok(account.shares.eq(firstMintShares.div(new anchor.BN(3)))) // we minted 1/3 amount
      const state = await systemProgram.state()
      assert.ok(
        state.shares.eq(
          firstMintShares.mul(new anchor.BN(2)).add(firstMintShares.div(new anchor.BN(3)))
        )
      )
    })
    it('mint wrong token', async () => {
      const { userSystemAccount, userWallet } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        mintAuthority: wallet,
        systemProgram,
        amount: new anchor.BN(100 * 1e8)
      })
      const stateBefore = await systemProgram.state()
      const userTokenAccount = await syntheticUsd.createAccount(userWallet.publicKey)
      try {
        await systemProgram.state.rpc.mint(new anchor.BN(1), {
          accounts: {
            owner: userWallet.publicKey,
            authority: mintAuthority,
            mint: collateralToken.publicKey,
            to: userTokenAccount,
            tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            userAccount: userSystemAccount.publicKey
          },
          signers: [userWallet],
          instructions: await updateAllFeeds(stateBefore, systemProgram)
        })
        assert.ok(false)
      } catch (error) {
        assert.equal(error.toString(), 'Wrong token not sythetic usd')
      }
    })
    it('mint over limit', async () => {
      const { userSystemAccount, userWallet } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        mintAuthority: wallet,
        systemProgram,
        amount: new anchor.BN(100 * 1e8)
      })
      const userTokenAccount = await syntheticUsd.createAccount(userWallet.publicKey)
      try {
        await mintUsd({
          userWallet,
          systemProgram,
          userSystemAccount,
          userTokenAccount,
          mintAuthority,
          mintAmount: new anchor.BN(50 * 1e8)
        })
        assert.ok(false)
      } catch (error) {
        assert.equal(error.toString(), 'Mint limit crossed')
      }
    })
  })

  describe('#widthdraw()', () => {
    it('withdraw with zero debt', async () => {
      const amountCollateral = new anchor.BN(100 * 1e8)
      const {
        userSystemAccount,
        userCollateralTokenAccount,
        userWallet
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        mintAuthority: wallet,
        systemProgram,
        amount: amountCollateral
      })
      const stateBefore = await systemProgram.state()
      await systemProgram.state.rpc.withdraw(amountCollateral, {
        accounts: {
          userAccount: userSystemAccount.publicKey,
          authority: mintAuthority,
          collateralAccount: collateralAccount,
          to: userCollateralTokenAccount,
          tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          owner: userWallet.publicKey
        },
        signers: [userWallet],
        instructions: await updateAllFeeds(stateBefore, systemProgram)
      })

      const info = await collateralToken.getAccountInfo(userCollateralTokenAccount)
      assert.ok(info.amount.eq(amountCollateral))

      const account = await systemProgram.account.userAccount(userSystemAccount.publicKey)
      const stateAfter = await systemProgram.state()

      assert.ok(account.collateral.eq(new anchor.BN(0)))
      assert.ok(
        stateBefore.collateralBalance.eq(stateAfter.collateralBalance.add(amountCollateral))
      )
    })
    it('withdraw with debt', async () => {
      const amountCollateral = new anchor.BN(100 * 1e8)
      const mintAmount = new anchor.BN(10 * 1e8)
      const {
        userSystemAccount,
        userCollateralTokenAccount,
        userWallet
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        mintAuthority: wallet,
        systemProgram,
        amount: amountCollateral
      })
      const userTokenAccount = await syntheticUsd.createAccount(userWallet.publicKey)
      await mintUsd({
        userWallet,
        systemProgram,
        userSystemAccount,
        userTokenAccount,
        mintAuthority,
        mintAmount: mintAmount
      })
      const stateBefore = await systemProgram.state()
      // we should be able to withdraw 75 tokens
      const amountCollateralWithdraw = new anchor.BN(75 * 1e8)

      await systemProgram.state.rpc.withdraw(amountCollateralWithdraw, {
        accounts: {
          userAccount: userSystemAccount.publicKey,
          authority: mintAuthority,
          collateralAccount: collateralAccount,
          to: userCollateralTokenAccount,
          tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          owner: userWallet.publicKey
        },
        signers: [userWallet],
        instructions: await updateAllFeeds(stateBefore, systemProgram)
      })

      const info = await collateralToken.getAccountInfo(userCollateralTokenAccount)
      assert.ok(info.amount.eq(amountCollateralWithdraw))

      const account = await systemProgram.account.userAccount(userSystemAccount.publicKey)
      const stateAfter = await systemProgram.state()

      assert.ok(account.collateral.eq(amountCollateral.sub(amountCollateralWithdraw)))
      assert.ok(
        stateBefore.collateralBalance.eq(stateAfter.collateralBalance.add(amountCollateralWithdraw))
      )
    })
    it('withdraw with debt over limit', async () => {
      const amountCollateral = new anchor.BN(100 * 1e8)
      const mintAmount = new anchor.BN(10 * 1e8)
      const {
        userSystemAccount,
        userCollateralTokenAccount,
        userWallet
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        mintAuthority: wallet,
        systemProgram,
        amount: amountCollateral
      })
      const userTokenAccount = await syntheticUsd.createAccount(userWallet.publicKey)
      await mintUsd({
        userWallet,
        systemProgram,
        userSystemAccount,
        userTokenAccount,
        mintAuthority,
        mintAmount: mintAmount
      })
      const stateBefore = await systemProgram.state()
      // we should be able to withdraw 75 tokens
      const amountCollateralWithdraw = new anchor.BN(76 * 1e8)
      try {
        await systemProgram.state.rpc.withdraw(amountCollateralWithdraw, {
          accounts: {
            userAccount: userSystemAccount.publicKey,
            authority: mintAuthority,
            collateralAccount: collateralAccount,
            to: userCollateralTokenAccount,
            tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            owner: userWallet.publicKey
          },
          signers: [userWallet],
          instructions: await updateAllFeeds(stateBefore, systemProgram)
        })
      } catch (error) {
        assert.ok(error.toString(), 'Not enough collateral')
      }
    })
  })
  describe('#burn()', () => {
    it('burn full', async () => {
      const mintAmount = new u64(1e8)
      const stateBefore = await systemProgram.state()
      const { userSystemAccount, userWallet } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        mintAuthority: wallet,
        systemProgram,
        amount: new anchor.BN(100 * 1e8)
      })
      const userTokenAccount = await syntheticUsd.createAccount(userWallet.publicKey)
      await mintUsd({
        userWallet,
        systemProgram,
        userSystemAccount,
        userTokenAccount,
        mintAuthority,
        mintAmount: mintAmount
      })

      await syntheticUsd.approve(userTokenAccount, mintAuthority, userWallet, [], mintAmount)
      await systemProgram.state.rpc.burn(mintAmount, {
        accounts: {
          authority: mintAuthority,
          mint: syntheticUsd.publicKey,
          userAccount: userSystemAccount.publicKey,
          userTokenAccount: userTokenAccount,
          tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          owner: userWallet.publicKey
        },
        signers: [userWallet]
      })
      const accountAfter = await syntheticUsd.getAccountInfo(userTokenAccount)
      const stateAfter = await systemProgram.state()
      const systemAccountAfter = await systemProgram.account.userAccount(
        userSystemAccount.publicKey
      )
      assert.ok(stateAfter.shares.eq(stateBefore.shares))
      assert.ok(stateAfter.assets[0].supply.eq(stateBefore.assets[0].supply))
      assert.ok(systemAccountAfter.shares.eq(new u64(0)))
      assert.ok(accountAfter.amount.eq(new u64(0)))
    })
    it('burn partial', async () => {
      const mintAmount = new u64(1e8)
      const burnAmount = mintAmount.div(new u64(5))
      const initialShares = new u64(1e8)
      const stateBefore = await systemProgram.state()

      const { userSystemAccount, userWallet } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        mintAuthority: wallet,
        systemProgram,
        amount: new anchor.BN(100 * 1e8)
      })
      const userTokenAccount = await syntheticUsd.createAccount(userWallet.publicKey)
      await mintUsd({
        userWallet,
        systemProgram,
        userSystemAccount,
        userTokenAccount,
        mintAuthority,
        mintAmount: mintAmount
      })
      await syntheticUsd.approve(userTokenAccount, mintAuthority, userWallet, [], tou64(burnAmount))
      await systemProgram.state.rpc.burn(burnAmount, {
        accounts: {
          authority: mintAuthority,
          mint: syntheticUsd.publicKey,
          userAccount: userSystemAccount.publicKey,
          userTokenAccount: userTokenAccount,
          tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          owner: userWallet.publicKey
        },
        signers: [userWallet]
      })
      const accountAfter = await syntheticUsd.getAccountInfo(userTokenAccount)
      const stateAfter = await systemProgram.state()
      const systemAccountAfter = await systemProgram.account.userAccount(
        userSystemAccount.publicKey
      )
      assert.ok(
        stateAfter.assets[0].supply.eq(stateBefore.assets[0].supply.add(mintAmount.sub(burnAmount)))
      )
      assert.ok(accountAfter.amount.eq(mintAmount.sub(burnAmount)))

      // we burn 1/5 of shares
      assert.ok(
        systemAccountAfter.shares.eq(initialShares.sub(initialShares.div(new anchor.BN(5))))
      )
      assert.ok(
        stateAfter.shares.eq(
          stateBefore.shares.add(initialShares.sub(initialShares.div(new anchor.BN(5))))
        )
      )
    })
    it('burn over limit', async () => {
      const stateBefore = await systemProgram.state()

      const mintAmount = new u64(1e8)
      const burnAmount = mintAmount.mul(new anchor.BN(2))
      const { userSystemAccount, userWallet } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        mintAuthority: wallet,
        systemProgram,
        amount: new anchor.BN(100 * 1e8)
      })
      const userTokenAccount = await syntheticUsd.createAccount(userWallet.publicKey)
      await mintUsd({
        userWallet,
        systemProgram,
        userSystemAccount,
        userTokenAccount,
        mintAuthority,
        mintAmount: mintAmount
      })

      await syntheticUsd.approve(userTokenAccount, mintAuthority, userWallet, [], tou64(burnAmount))
      await systemProgram.state.rpc.burn(burnAmount, {
        accounts: {
          authority: mintAuthority,
          mint: syntheticUsd.publicKey,
          userAccount: userSystemAccount.publicKey,
          userTokenAccount: userTokenAccount,
          tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          owner: userWallet.publicKey
        },
        signers: [userWallet]
      })
      const accountAfter = await syntheticUsd.getAccountInfo(userTokenAccount)
      const stateAfter = await systemProgram.state()
      const systemAccountAfter = await systemProgram.account.userAccount(
        userSystemAccount.publicKey
      )
      assert.ok(stateAfter.assets[0].supply.eq(stateBefore.assets[0].supply))
      assert.ok(accountAfter.amount.eq(new anchor.BN(0)))

      assert.ok(systemAccountAfter.shares.eq(new anchor.BN(0)))
      assert.ok(stateAfter.shares.eq(stateBefore.shares))
    })
  })
  describe('#swap(', () => {
    it('swaps synthetic usd to other token', async () => {
      const tokenPrice = new anchor.BN(2 * 1e4)
      const mintedSyntheticUsd = new anchor.BN(100 * 1e8)
      const newToken = await createToken({ connection, mintAuthority, wallet })
      const tokenFeed = await createPriceFeed({ admin, oracleProgram, tokenPrice })

      // TODO: Create and Add price feed to this new token
      await systemProgram.state.rpc.addAsset(Buffer.from('test'), {
        accounts: {
          assetAddress: newToken.publicKey,
          feedAddress: tokenFeed.publicKey,
          admin: wallet.publicKey
        },
        signer: [wallet]
      })
      const state = await systemProgram.state()
      assert.ok(state.assets.length === 3)
      assert.ok(state.assets[2].feedAddress.equals(tokenFeed.publicKey))
      assert.ok(state.assets[2].assetAddress.equals(newToken.publicKey))
      const { userSystemAccount, userWallet } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        mintAuthority: wallet,
        systemProgram,
        amount: new anchor.BN(10000 * 1e8)
      })
      const userSyntheticUsdAccount = await syntheticUsd.createAccount(userWallet.publicKey)
      const userNewTokenAccount = await newToken.createAccount(userWallet.publicKey)
      const stateUpdated = await systemProgram.state()

      await mintUsd({
        userWallet,
        systemProgram,
        userSystemAccount,
        userTokenAccount: userSyntheticUsdAccount,
        mintAuthority,
        mintAmount: mintedSyntheticUsd
      })
      await syntheticUsd.approve(
        userSyntheticUsdAccount,
        mintAuthority,
        userWallet,
        [],
        tou64(mintedSyntheticUsd)
      )

      await systemProgram.state.rpc.swap(mintedSyntheticUsd, {
        accounts: {
          userAccount: userSystemAccount.publicKey,
          authority: mintAuthority,
          tokenIn: syntheticUsd.publicKey,
          tokenFor: newToken.publicKey,
          userTokenAccountIn: userSyntheticUsdAccount,
          userTokenAccountFor: userNewTokenAccount,
          tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          owner: userWallet.publicKey
        },
        signers: [userWallet],
        instructions: await updateAllFeeds(stateUpdated, systemProgram)
      })
      const accountUsd = await syntheticUsd.getAccountInfo(userSyntheticUsdAccount)
      const accountNewToken = await newToken.getAccountInfo(userNewTokenAccount)
      assert.ok(accountUsd.amount.eq(new anchor.BN(0)))
      assert.ok(accountNewToken.amount.eq(new anchor.BN('4985000000')))
    })
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
