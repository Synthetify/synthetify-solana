#![feature(proc_macro_hygiene)]

use anchor_lang::prelude::*;

// Chainlink folks if you want Anchor price feed implementation DM me.

// Define the program's instruction handlers.

#[program]
mod oracle {
    use super::*;

    pub fn create(
        ctx: Context<Create>,
        admin: Pubkey,
        initial_price: u64,
        ticker: Vec<u8>,
    ) -> ProgramResult {
        let counter = &mut ctx.accounts.price_feed;
        counter.symbol = ticker;
        counter.admin = admin;
        counter.price = initial_price;
        counter.paused = false;
        Ok(())
    }

    pub fn set_paused(ctx: Context<Pause>, paused: bool) -> ProgramResult {
        let counter = &mut ctx.accounts.price_feed;
        counter.paused = paused;
        Ok(())
    }

    pub fn set_price(ctx: Context<SetPrice>, price: u64) -> ProgramResult {
        let counter = &mut ctx.accounts.price_feed;
        counter.price = price;
        Ok(())
    }
}

// Define the validated accounts for each handler.

#[derive(Accounts)]
pub struct Create<'info> {
    #[account(init)]
    pub price_feed: ProgramAccount<'info, PriceFeed>,
    pub rent: Sysvar<'info, Rent>,
}
#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut, has_one = admin)]
    pub price_feed: ProgramAccount<'info, PriceFeed>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct SetPrice<'info> {
    #[account(mut, has_one = admin)]
    pub price_feed: ProgramAccount<'info, PriceFeed>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
}

// Define the program owned accounts.

#[account]
pub struct PriceFeed {
    pub admin: Pubkey,
    pub price: u64,
    pub paused: bool,
    pub symbol: Vec<u8>,
}
