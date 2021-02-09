const { Token } = require('@solana/spl-token')
const TokenInstructions = require('@project-serum/serum').TokenInstructions
const anchor = require('@project-serum/anchor')

const createToken = async ({ connection, wallet, mintAuthority }) => {
  const token = await Token.createMint(
    connection,
    wallet,
    mintAuthority,
    null,
    8,
    TokenInstructions.TOKEN_PROGRAM_ID
  )
  return token
}
const createAccountWithCollateral = async ({
  systemProgram,
  mintAuthority,
  collateralToken,
  collateralAccount,
  amount = new anchor.BN(100 * 1e8)
}) => {
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
  const userCollateralTokenAccount = await collateralToken.createAccount(userAccount.publicKey)
  await collateralToken.mintTo(userCollateralTokenAccount, mintAuthority, [], amount.toNumber())

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
  return { userWallet, userSystemAccount: userAccount }
}
const createPriceFeed = async ({
  oracleProgram,
  admin,
  initPrice = new anchor.BN(2 * 1e4),
  ticker = Buffer.from('GME')
}) => {
  const collateralTokenFeed = new anchor.web3.Account()
  await oracleProgram.rpc.create(admin.publicKey, initPrice, ticker, {
    accounts: {
      priceFeed: collateralTokenFeed.publicKey,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY
    },
    signers: [collateralTokenFeed],
    instructions: [await oracleProgram.account.priceFeed.createInstruction(collateralTokenFeed, 56)]
  })
  return collateralTokenFeed
}

module.exports = { createToken, createAccountWithCollateral, createPriceFeed }
