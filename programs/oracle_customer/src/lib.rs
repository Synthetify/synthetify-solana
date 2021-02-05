#![feature(proc_macro_hygiene)]

use anchor_lang::prelude::*;
use oracle::PriceFeed;
#[program]
pub mod oracle_customer {
    use super::*;
    #[state]
    pub struct InternalState {
        price: u64,
        ticker: Vec<u8>,
    }

    impl InternalState {
        pub fn new(_ctx: Context<Auth>) -> Result<Self> {
            Ok(Self {
                price: 0,
                ticker: vec![1, 2, 3],
            })
        }
        pub fn pull_data(&mut self, ctx: Context<PullData>) -> Result<()> {
            self.price = ctx.accounts.price_feed_account.price;
            self.ticker = ctx.accounts.price_feed_account.symbol.clone();
            Ok(())
        }
    }
}
#[derive(Accounts)]
pub struct Auth {}

#[derive(Accounts)]
pub struct PullData<'info> {
    pub price_feed_account: CpiAccount<'info, PriceFeed>,
}
#[error]
pub enum ErrorCode {
    #[msg("Your error message")]
    ErrorType,
}
