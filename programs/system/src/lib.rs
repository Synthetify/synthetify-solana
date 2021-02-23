#![feature(proc_macro_hygiene)]

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, MintTo, TokenAccount, Transfer};
mod math;
use math::*;
use oracle::PriceFeed;
#[program]
pub mod system {

    use super::*;
    #[state]
    pub struct InternalState {
        pub nonce: u8,
        pub signer: Pubkey,
        pub admin: Pubkey,
        pub initialized: bool,
        pub debt: u64,
        pub shares: u64,
        pub collateral_balance: u64,
        pub collateral_token: Pubkey,
        pub collateral_account: Pubkey,
        pub collateralization_level: u32,
        pub max_delay: u32,
        pub fee: u8, // should be in range 0-99
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
                admin: Pubkey::default(),
                initialized: false,
                debt: 0,
                shares: 0,
                collateral_balance: 0,
                collateralization_level: 500, // 500%
                max_delay: 1000,
                fee: 30, // 0.3%
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
            admin: Pubkey,
            collateral_token: Pubkey,
            collateral_account: Pubkey,
            collateral_token_feed: Pubkey,
            usd_token: Pubkey,
        ) -> Result<()> {
            self.initialized = true;
            self.signer = signer;
            self.nonce = nonce;
            self.admin = admin;
            self.collateral_token = collateral_token;
            self.collateral_account = collateral_account;
            //clean asset array + add synthetic Usd
            let usd_asset = Asset {
                decimals: 8,
                asset_address: usd_token,
                feed_address: Pubkey::default(), // unused
                last_update: std::u64::MAX,
                price: 1 * 10u64.pow(4),
                supply: 0,
            };
            let collateral_asset = Asset {
                decimals: 8,
                asset_address: collateral_token,
                feed_address: collateral_token_feed,
                last_update: 0,
                price: 0,
                supply: 0,
            };
            self.assets = vec![usd_asset, collateral_asset];
            Ok(())
        }
        // This only support sythetic USD
        pub fn mint(&mut self, ctx: Context<Mint>, amount: u64) -> Result<()> {
            msg!("mint");
            let user_account = &mut ctx.accounts.user_account;
            let mint_token_adddress = ctx.accounts.mint.to_account_info().clone().key;
            if !mint_token_adddress.eq(&self.assets[0].asset_address) {
                return Err(ErrorCode::NotSyntheticUsd.into());
            }
            let slot = ctx.accounts.clock.slot;
            let debt = calculate_debt(&self.assets, slot, self.max_delay).unwrap();

            let user_debt = calculate_user_debt_in_usd(user_account, debt, self.shares);
            let collateral_asset = self
                .assets
                .clone()
                .into_iter()
                .find(|x| x.asset_address == self.collateral_token)
                .unwrap();

            let mint_asset = self
                .assets
                .iter_mut()
                .find(|x| x.asset_address == *mint_token_adddress)
                .unwrap();
            let amount_mint_usd = calculate_amount_mint_in_usd(*mint_asset, amount);

            let max_user_debt = calculate_max_user_debt_in_usd(
                collateral_asset,
                self.collateralization_level,
                user_account,
            );
            if max_user_debt - user_debt < amount_mint_usd {
                return Err(ErrorCode::MintLimit.into());
            }
            let new_shares = calculate_new_shares(&self.shares, &debt, &amount_mint_usd);
            self.debt = debt + amount_mint_usd;

            self.shares += new_shares;
            user_account.shares += new_shares;
            mint_asset.supply += amount;
            let seeds = &[self.signer.as_ref(), &[self.nonce]];
            let signer = &[&seeds[..]];
            let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::mint_to(cpi_ctx, amount);
            Ok(())
        }
        pub fn withdraw(&mut self, ctx: Context<Withdraw>, amount: u64) -> Result<()> {
            let user_account = &mut ctx.accounts.user_account;
            let slot = ctx.accounts.clock.slot;
            let debt = calculate_debt(&self.assets, slot, self.max_delay).unwrap();
            let user_debt = calculate_user_debt_in_usd(user_account, debt, self.shares);

            let collateral_asset = self
                .assets
                .clone()
                .into_iter()
                .find(|x| x.asset_address == self.collateral_token)
                .unwrap();

            let max_user_debt = calculate_max_user_debt_in_usd(
                collateral_asset,
                self.collateralization_level,
                user_account,
            );

            let max_withdraw_in_usd = calculate_max_withdraw_in_usd(
                &max_user_debt,
                &user_debt,
                &self.collateralization_level,
            );
            // TODO refactor move to math.rs
            let max_amount_to_withdraw = max_withdraw_in_usd
                * 10u64.pow(4) // oracle got 4 places offset 
                / collateral_asset.price;
            msg!("max amount to withdraw : {:?}", max_amount_to_withdraw);
            if max_amount_to_withdraw < amount {
                return Err(ErrorCode::WithdrawError.into());
            }
            user_account.collateral -= amount;
            self.collateral_balance -= amount;
            let seeds = &[self.signer.as_ref(), &[self.nonce]];
            let signer = &[&seeds[..]];
            let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::transfer(cpi_ctx, amount);
            Ok(())
        }

        pub fn add_asset(&mut self, ctx: Context<AddAsset>) -> Result<()> {
            if !self.admin.eq(ctx.accounts.admin.key){
                return Err(ErrorCode::Unauthorized.into());
            }
            if self.assets.len() == Self::ASSETS_SIZE {
                return Err(ErrorCode::AssetsFull.into());
            }
            // TODO add check if asset exist
            let new_asset = Asset {
                asset_address: *ctx.accounts.asset_address.to_account_info().key,
                feed_address: *ctx.accounts.feed_address.to_account_info().key,
                price: 0,
                supply: 0,
                last_update: 0,
                decimals: 8,
            };
            self.assets.push(new_asset);
            Ok(())
        }
        pub fn deposit(&mut self, ctx: Context<Deposit>) -> Result<()> {
            let new_balance = ctx.accounts.collateral_account.amount;
            let deposited = new_balance - self.collateral_balance;
            if deposited == 0 {
                return Err(ErrorCode::ZeroDeposit.into());
            }
            let user_account = &mut ctx.accounts.user_account;
            user_account.collateral += deposited;
            self.collateral_balance = new_balance;
            Ok(())
        }
        pub fn update_price(
            &mut self,
            ctx: Context<UpdatePrice>,
            feed_address: Pubkey,
        ) -> Result<()> {
            msg!("#################################");
            let asset = self
                .assets
                .iter_mut()
                .find(|x| x.feed_address == feed_address)
                .unwrap();
            let slot = ctx.accounts.clock.slot;
            asset.price = ctx.accounts.price_feed_account.price;
            asset.last_update = slot;
            Ok(())
        }
        pub fn burn(&mut self, ctx: Context<BurnToken>, amount: u64) -> Result<()> {
            let user_account = &mut ctx.accounts.user_account;
            let token_address = ctx.accounts.mint.key;
            let slot = ctx.accounts.clock.slot;
            let debt = calculate_debt(&self.assets, slot, self.max_delay).unwrap();
            let burn_asset = self
                .assets
                .iter_mut()
                .find(|x| x.asset_address == *token_address)
                .unwrap();

            let user_debt = calculate_user_debt_in_usd(user_account, debt, self.shares);

            let burned_shares =
                calculate_burned_shares(&burn_asset, &user_debt, &user_account.shares, &amount);
            // msg!("Burned shares {}", burned_shares);
            // msg!("User shares {}", user_account.shares);
            if burned_shares > user_account.shares {
                let burned_amount = calculate_max_burned_in_token(burn_asset, &user_debt);
                burn_asset.supply -= burned_amount;
                self.shares -= user_account.shares;
                user_account.shares = 0;
                let seeds = &[self.signer.as_ref(), &[self.nonce]];
                let signer = &[&seeds[..]];
                let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
                token::burn(cpi_ctx, burned_amount);
                Ok(())
            } else {
                burn_asset.supply -= amount;
                user_account.shares -= burned_shares;
                self.shares -= burned_shares;
                let seeds = &[self.signer.as_ref(), &[self.nonce]];
                let signer = &[&seeds[..]];
                let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
                token::burn(cpi_ctx, amount);
                Ok(())
            }
        }
        pub fn swap(&mut self, ctx: Context<Swap>, amount: u64) -> Result<()> {
            let user_account = &mut ctx.accounts.user_account;
            // We allow washtrading
            let token_address_in = ctx.accounts.token_in.key;
            let token_address_for = ctx.accounts.token_for.key;
            let slot = ctx.accounts.clock.slot;

            if token_address_for.eq(&self.assets[1].asset_address) {
                return Err(ErrorCode::SyntheticCollateral.into());
            }
            let asset_in_index = self
                .assets
                .iter()
                .position(|x| x.asset_address == *token_address_in)
                .unwrap();
            let asset_for_index = self
                .assets
                .iter()
                .position(|x| x.asset_address == *token_address_for)
                .unwrap();
            if (self.assets[asset_in_index].last_update + self.max_delay as u64) < slot
                || (self.assets[asset_for_index].last_update + self.max_delay as u64) < slot
            {
                return Err(ErrorCode::OutdatedOracle.into());
            }
            let amount_for = calculate_swap_out_amount(
                &self.assets[asset_in_index],
                &self.assets[asset_for_index],
                &amount,
                &self.fee,
            );
            let seeds = &[self.signer.as_ref(), &[self.nonce]];
            let signer = &[&seeds[..]];

            let cpi_ctx_burn: CpiContext<Burn> =
                CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::burn(cpi_ctx_burn, amount);

            let cpi_ctx_mint: CpiContext<MintTo> =
                CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::mint_to(cpi_ctx_mint, amount_for);
            Ok(())
        }
    }
    pub fn create_user_account(ctx: Context<CreateUserAccount>, owner: Pubkey) -> ProgramResult {
        let user_account = &mut ctx.accounts.user_account;
        user_account.owner = owner;
        user_account.shares = 0;
        user_account.collateral = 0;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct New {}
#[derive(Accounts)]
pub struct Initialize {}
#[derive(Accounts)]
pub struct CreateUserAccount<'info> {
    #[account(init)]
    pub user_account: ProgramAccount<'info, UserAccount>,
    pub rent: Sysvar<'info, Rent>,
}
#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    pub price_feed_account: CpiAccount<'info, PriceFeed>,
    pub clock: Sysvar<'info, Clock>,
}
#[derive(Accounts)]
pub struct Mint<'info> {
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub mint: AccountInfo<'info>,
    #[account(mut)]
    pub to: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub user_account: ProgramAccount<'info, UserAccount>,
    pub clock: Sysvar<'info, Clock>,
    #[account(signer)]
    owner: AccountInfo<'info>,
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
pub struct BurnToken<'info> {
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub mint: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    #[account(mut)]
    pub user_token_account: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub user_account: ProgramAccount<'info, UserAccount>,
    pub clock: Sysvar<'info, Clock>,
    #[account(signer)]
    owner: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&BurnToken<'info>> for CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
    fn from(accounts: &BurnToken<'info>) -> CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
        let cpi_accounts = Burn {
            mint: accounts.mint.to_account_info(),
            to: accounts.user_token_account.to_account_info(),
            authority: accounts.authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct Swap<'info> {
    pub authority: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    #[account(mut)]
    pub token_in: AccountInfo<'info>,
    #[account(mut)]
    pub token_for: AccountInfo<'info>,
    #[account(mut)]
    pub user_token_account_in: AccountInfo<'info>,
    #[account(mut)]
    pub user_token_account_for: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub user_account: ProgramAccount<'info, UserAccount>,
    pub clock: Sysvar<'info, Clock>,
    #[account(signer)]
    owner: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&Swap<'info>> for CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
    fn from(accounts: &Swap<'info>) -> CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
        let cpi_accounts = Burn {
            mint: accounts.token_in.to_account_info(),
            to: accounts.user_token_account_in.to_account_info(),
            authority: accounts.authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
impl<'a, 'b, 'c, 'info> From<&Swap<'info>> for CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
    fn from(accounts: &Swap<'info>) -> CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
        let cpi_accounts = MintTo {
            mint: accounts.token_for.to_account_info(),
            to: accounts.user_token_account_for.to_account_info(),
            authority: accounts.authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, has_one = owner)]
    pub user_account: ProgramAccount<'info, UserAccount>,
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub collateral_account: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub to: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    pub clock: Sysvar<'info, Clock>,
    #[account(signer)]
    owner: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&Withdraw<'info>> for CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
    fn from(accounts: &Withdraw<'info>) -> CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: accounts.collateral_account.to_account_info(),
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
    #[account(signer)]
    pub admin: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct Deposit<'info> {
    // #[account(signer)]
    // pub test: AccountInfo<'info>,
    #[account(mut)]
    pub user_account: ProgramAccount<'info, UserAccount>,
    pub collateral_account: CpiAccount<'info, TokenAccount>,
}
#[account]
pub struct UserAccount {
    pub owner: Pubkey,
    pub shares: u64,
    pub collateral: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Default, Copy, Clone)]
pub struct Asset {
    pub feed_address: Pubkey,
    pub asset_address: Pubkey,
    pub price: u64,
    pub last_update: u64,
    pub supply: u64,
    pub decimals: u8,
}

#[error]
pub enum ErrorCode {
    #[msg("Your error message")]
    ErrorType,
    #[msg("Assets is full")]
    AssetsFull,
    #[msg("Deposited zero")]
    ZeroDeposit,
    #[msg("Outdated oracle")]
    OutdatedOracle,
    #[msg("Missing Collateral token")]
    MissingCollateralToken,
    #[msg("Mint limit crossed")]
    MintLimit,
    #[msg("Wrong token not sythetic usd")]
    NotSyntheticUsd,
    #[msg("Not enough collateral")]
    WithdrawError,
    #[msg("Synthetic collateral is not supported")]
    SyntheticCollateral,
    #[msg("You are not admin of system")]
    Unauthorized,
}
