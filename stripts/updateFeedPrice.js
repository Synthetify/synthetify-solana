// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

const anchor = require('@project-serum/anchor')
const { PublicKey, Account } = require('@solana/web3.js')
const { createPriceFeed, createToken, newAccountWithLamports } = require('../tests/utils')
const admin = require('../migrations/testAdmin')
const Binance = require('binance-api-node').default
const main = async () => {
  const client = Binance()
  const provider = anchor.Provider.local('https://devnet.solana.com', {
    commitment: 'singleGossip',
    preflightCommitment: 'singleGossip',
    skipPreflight: true
  })
  const oracleIdl = JSON.parse(require('fs').readFileSync('./target/idl/oracle.json', 'utf8'))
  const systemIdl = JSON.parse(require('fs').readFileSync('./target/idl/system.json', 'utf8'))
  const oracleAddress = new anchor.web3.PublicKey('2DZFhZtw94pnyoXuLfovtYZwtv1ZBLqsr3va65KKVCsz')
  const systemAddress = new anchor.web3.PublicKey('95tSv88thk5XPCXFaEuGbKUBuiHHVNaQr1m61xgu72p8')
  const systemProgram = new anchor.Program(systemIdl, systemAddress, provider)
  anchor.setProvider(provider)
  const connection = provider.connection
  const wallet = provider.wallet.payer
  const oracleProgram = new anchor.Program(oracleIdl, oracleAddress, provider)
  const newPrice = new anchor.BN(40 * 1e4)
  const state = await systemProgram.state()
  // console.log(state)
  const updateOracle = async () => {
    console.log('feed update')
    try {
      for (const asset of state.assets) {
        const ticker = asset.ticker.toString()
        if (!ticker.startsWith('x') || ticker === 'xUSD') {
          continue
        }
        // console.log(`${ticker.substring(1)}USDT`)
        const price = await client.avgPrice({ symbol: `${ticker.substring(1)}USDT` })
        const parsedPrice = (parseFloat(price.price) * 1e4).toFixed(0)
        await oracleProgram.rpc.setPrice(new anchor.BN(parsedPrice), {
          accounts: {
            priceFeed: asset.feedAddress,
            admin: wallet.publicKey
          },
          signers: [wallet]
        })
      }
      setTimeout(async () => {
        await updateOracle()
      }, 60000)
    } catch (error) {
      setTimeout(async () => {
        await updateOracle()
      }, 60000)
    }
  }
  await updateOracle()
}

main()
