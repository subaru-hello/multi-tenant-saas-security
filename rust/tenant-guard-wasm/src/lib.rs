use tenant_invariant::{check_tenant, Actor, Decision, ResourceOwner, TenantId};
use wasm_bindgen::prelude::*;

/// Thin WebAssembly adapter around the tenant-invariant crate.
///
/// The TypeScript application passes two independently resolved values:
/// the tenant from authenticated context and the owner from its database.
#[wasm_bindgen]
pub fn check_tenant_access(actor_tenant: &str, owner_tenant: Option<String>) -> String {
    let Ok(actor_tenant) = TenantId::new(actor_tenant) else {
        return "InvalidActorTenant".to_owned();
    };

    let actor = Actor {
        tenant: actor_tenant,
    };

    let owner = match owner_tenant {
        Some(value) => match TenantId::new(value) {
            Ok(tenant) => ResourceOwner::Tenant(tenant),
            Err(_) => ResourceOwner::Unknown,
        },
        None => ResourceOwner::Unknown,
    };

    match check_tenant(&actor, &owner) {
        Decision::Allow => "Allow".to_owned(),
        Decision::Deny(reason) => format!("{reason:?}"),
    }
}
