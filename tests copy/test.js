const anchor = require('@project-serum/anchor')
const assert = require('assert')
const { Token } = require('@solana/spl-token')
const TokenInstructions = require('@project-serum/serum').TokenInstructions
describe('Core', async () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  anchor.setProvider(provider)
  const wallet = provider.wallet.payer
  const coreProgram = anchor.workspace.Test
  const coreProgramAddress = coreProgram.programId
  console.log(coreProgramAddress.toString())
  const authority = new anchor.web3.Account();
  let tokenAddress
  let token
  let signer
  let nonce
  before(async () => {
    let [_vestingSigner, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [authority.publicKey.toBuffer()],
      coreProgramAddress
    )
    signer = _vestingSigner
    nonce = _nonce
    console.log(signer.toString())
    console.log(nonce)
    const tx = await Token.createMint(
      connection,
      wallet,
      signer,
      null,
      8,
      TokenInstructions.TOKEN_PROGRAM_ID
    )
    tokenAddress = tx.publicKey
    token = new Token(connection, tokenAddress, TokenInstructions.TOKEN_PROGRAM_ID, wallet)
  })
  beforeEach(async () => {})
  it('#mint()', async () => {
    const userAccount = new anchor.web3.Account()
    const tokenAccount = await token.createAccount(userAccount.publicKey)
    // console.log(acc)

    await coreProgram.rpc.proxyMintTo(new anchor.BN(1000), nonce, {
      accounts: {
        authority: authority.publicKey,
        mint: tokenAddress,
        to: tokenAccount,
        contract: signer,
        tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
      },
    })
    // await token.mintTo(acc, wallet, [], 1000)
    // console.log((await token.getMintInfo()).mintAuthority.toString())
    const info = await token.getAccountInfo(tokenAccount)
    console.log(info)
  })
})
