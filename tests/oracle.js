const anchor = require('@project-serum/anchor')
const assert = require('assert')
describe('oracle', () => {
  const provider = anchor.Provider.local()
  // Configure the client to use the local cluster.
  anchor.setProvider(provider)
  const feed = new anchor.web3.Account()
  const program = anchor.workspace.Oracle

  it('Create feed', async () => {
    // Add your test here.
    // console.log(provider.wallet)
    // console.log(anchor.Provider.env())
    // console.log(anchor.workspace)
    // console.log(program)
    const initPrice = new anchor.BN(10)
    const ticker = Buffer.from('ABC', 'utf-8')
    // console.log(feed)
    await program.rpc.create(provider.wallet.publicKey, initPrice, ticker, {
      accounts: {
        priceFeed: feed.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [feed],
      // WHY 56 tho?
      instructions: [await program.account.priceFeed.createInstruction(feed, 56)],
    })
    // await program.account.priceFeed.createInstruction(priceFeed, initPrice)

    const account = await program.account.priceFeed(feed.publicKey)
    console.log(account)
    assert.equal(account.paused, false)
    // console.log(program.account.priceFeed)
    // console.log('Your transaction signature', tx)
  })
  it('Pause feed', async () => {
    await program.rpc.pause({
      accounts: {
        priceFeed: feed.publicKey,
        admin: provider.wallet.publicKey,
      },
      signers: [provider.wallet.payer],
    })
    const account = await program.account.priceFeed(feed.publicKey)
    console.log(account)
    assert.equal(account.paused, true)
  })
})
