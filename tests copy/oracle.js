const anchor = require('@project-serum/anchor')
const assert = require('assert')
describe('oracle', () => {
  const provider = anchor.Provider.local()
  anchor.setProvider(provider)

  const program = anchor.workspace.Oracle
  let priceFeed
  let admin
  const initPrice = new anchor.BN(100)
  const ticker = Buffer.from('GME', 'utf-8')
  beforeEach(async () => {
    // create Oracle
    priceFeed = new anchor.web3.Account()
    admin = new anchor.web3.Account()
    await program.rpc.create(admin.publicKey, initPrice, ticker, {
      accounts: {
        priceFeed: priceFeed.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [priceFeed],
      // WHY 56 tho?
      instructions: [await program.account.priceFeed.createInstruction(priceFeed, 56)],
    })
  })

  it('Check initial priceFeed', async () => {
    const account = await program.account.priceFeed(priceFeed.publicKey)
    assert.equal(account.paused, false)
    assert.ok(account.price.eq(initPrice))
    assert.ok(account.admin.equals(admin.publicKey))
    assert.ok(account.symbol.equals(ticker))
  })

  it('Pause feed', async () => {
    await program.rpc.setPaused(true, {
      accounts: {
        priceFeed: priceFeed.publicKey,
        admin: admin.publicKey,
      },
      signers: [admin],
    })
    const accountFeedPaused = await program.account.priceFeed(priceFeed.publicKey)
    assert.equal(accountFeedPaused.paused, true)

    await program.rpc.setPaused(false, {
      accounts: {
        priceFeed: priceFeed.publicKey,
        admin: admin.publicKey,
      },
      signers: [admin],
    })
    const accountFeedLive = await program.account.priceFeed(priceFeed.publicKey)
    assert.equal(accountFeedLive.paused, false)
  })

  it('Set newPrice', async () => {
    const newPrice = new anchor.BN(123)
    await program.rpc.setPrice(newPrice, {
      accounts: {
        priceFeed: priceFeed.publicKey,
        admin: admin.publicKey,
      },
      signers: [admin],
    })
    const account = await program.account.priceFeed(priceFeed.publicKey)
    assert.ok(account.price.eq(newPrice))
  })

  describe('Wrong admin', async () => {
    it('Fails to set newPrice', async () => {
      const newPrice = new anchor.BN(123)
      fakeAdmin = new anchor.web3.Account()
      try {
        await program.rpc.setPrice(newPrice, {
          accounts: {
            priceFeed: priceFeed.publicKey,
            admin: admin.publicKey,
          },
          signers: [fakeAdmin],
        })
        assert.ok(false)
      } catch (error) {
        // Need support for custom error messages here
        // console.log(error)
      }

      const account = await program.account.priceFeed(priceFeed.publicKey)
      assert.equal(account.price.eq(newPrice), false)
    })
    it('Fails to set pause', async () => {
      fakeAdmin = new anchor.web3.Account()
      const accountBefore = await program.account.priceFeed(priceFeed.publicKey)
      assert.equal(accountBefore.paused, false)
      try {
        await program.rpc.setPaused(true, {
          accounts: {
            priceFeed: priceFeed.publicKey,
            admin: admin.publicKey,
          },
          signers: [fakeAdmin],
        })

        assert.ok(false)
      } catch (error) {
        // Need support for custom error messages here
        // console.log(error)
      }

      const accountAfter = await program.account.priceFeed(priceFeed.publicKey)
      assert.equal(accountAfter.paused, false)
    })
  })
})
