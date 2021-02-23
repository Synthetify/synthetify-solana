#![feature(proc_macro_hygiene)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use anchor_lang::solana_program::account_info::AccountInfo;
use anchor_lang::solana_program::entrypoint::ProgramResult;
use anchor_lang::solana_program::program_error::ProgramError;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::{Accounts, CpiContext};
use anchor_spl::token::{self, Burn, MintTo, Transfer};
use std::ops::Deref;

// pub use anchor_spl::token::ID;

#[program]
pub mod test {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>) -> ProgramResult {
        Ok(())
    }
    pub fn proxy_mint_to(ctx: Context<ProxyMintTo>, amount: u64, nonce: u8) -> ProgramResult {
        let seeds = &[
            ctx.accounts.authority.to_account_info().key.as_ref(),
            &[nonce],
        ];
        let signer = &[&seeds[..]];
        let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::mint_to(cpi_ctx, amount);
        Ok(())
    }
}
#[derive(Accounts)]
pub struct ProxyMintTo<'info> {
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub mint: AccountInfo<'info>,
    #[account(mut)]
    pub to: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    pub contract: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct Initialize {}

impl<'a, 'b, 'c, 'info> From<&ProxyMintTo<'info>> for CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
    fn from(accounts: &ProxyMintTo<'info>) -> CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
        let cpi_accounts = MintTo {
            mint: accounts.mint.to_account_info(),
            to: accounts.to.to_account_info(),
            authority: accounts.contract.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
