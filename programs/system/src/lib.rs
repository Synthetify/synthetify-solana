#![feature(proc_macro_hygiene)]

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, MintTo, Transfer};

#[program]
pub mod system {
    use super::*;
    #[state]
    pub struct InternalState {
        pub nonce: u8,
        pub signer: Pubkey,
        pub initialized: bool,
        pub debt: u64,
        pub shares: u64,
        pub collateral_token: Pubkey,
        pub collateral_account: Pubkey,
        pub assets: Vec<Asset>,
    }

    impl InternalState {
        pub const ASSETS_SIZE: usize = 3;
        pub fn new(_ctx: Context<New>) -> Result<Self> {
            let mut assets = vec![];
            assets.resize(Self::ASSETS_SIZE, Default::default());
            Ok(Self {
                nonce: 0,
                signer: Pubkey::default(),
                initialized: false,
                debt: 0,
                shares: 0,
                collateral_token: Pubkey::default(),
                collateral_account: Pubkey::default(),
                assets,
            })
        }
        pub fn initialize(
            &mut self,
            ctx: Context<Initialize>,
            nonce: u8,
            signer: Pubkey,
            collateral_token: Pubkey,
            collateral_account: Pubkey,
        ) -> Result<()> {
            let seeds = &[signer.as_ref(), &[nonce]];
            self.initialized = true;
            self.signer = signer;
            self.nonce = nonce;
            self.collateral_token = collateral_token;
            self.collateral_account = collateral_account;
            //clean asset array
            self.assets = vec![];
            Ok(())
        }
        pub fn mint(&mut self, ctx: Context<Mint>, amount: u64) -> Result<()> {
            let seeds = &[self.signer.as_ref(), &[self.nonce]];
            let signer = &[&seeds[..]];
            let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::mint_to(cpi_ctx, amount);
            Ok(())
        }
        pub fn withdraw(&mut self, ctx: Context<Withdraw>, amount: u64) -> Result<()> {
            let seeds = &[self.signer.as_ref(), &[self.nonce]];
            let signer = &[&seeds[..]];
            let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::transfer(cpi_ctx, amount);
            Ok(())
        }
        pub fn add_asset(&mut self, ctx: Context<AddAsset>) -> Result<()> {
            if self.assets.len() == Self::ASSETS_SIZE {
                return Err(ErrorCode::AssetsFull.into());
            }
            // TODO add check if asset exist
            let new_asset = Asset {
                asset_address: *ctx.accounts.asset_address.to_account_info().key,
                feed_address: *ctx.accounts.feed_address.to_account_info().key,
                price: 0,
                supply: 0,
            };
            self.assets.push(new_asset);
            Ok(())
        }
    }
}

#[derive(Accounts)]
pub struct New {}
#[derive(Accounts)]
pub struct Initialize {}

#[derive(Accounts)]
pub struct Mint<'info> {
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub mint: AccountInfo<'info>,
    #[account(mut)]
    pub to: AccountInfo<'info>,

    pub token_program: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&Mint<'info>> for CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
    fn from(accounts: &Mint<'info>) -> CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
        let cpi_accounts = MintTo {
            mint: accounts.mint.to_account_info(),
            to: accounts.to.to_account_info(),
            authority: accounts.authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub from: AccountInfo<'info>,
    #[account(mut)]
    pub to: AccountInfo<'info>,
    #[account(mut)]
    pub token_program: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&Withdraw<'info>> for CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
    fn from(accounts: &Withdraw<'info>) -> CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: accounts.from.to_account_info(),
            to: accounts.to.to_account_info(),
            authority: accounts.authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct AddAsset<'info> {
    pub asset_address: AccountInfo<'info>,
    pub feed_address: AccountInfo<'info>,
}
#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Default, Copy, Clone)]
pub struct Asset {
    pub feed_address: Pubkey,
    pub asset_address: Pubkey,
    pub price: u64,
    pub supply: u64,
}

#[error]
pub enum ErrorCode {
    #[msg("Your error message")]
    ErrorType,
    #[msg("Assets is full")]
    AssetsFull,
}
