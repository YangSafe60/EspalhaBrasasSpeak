use speakapp_shared::{PermissionOverwrite, OverwriteTarget, Permissions};
use uuid::Uuid;
fn main() {
  let ow = PermissionOverwrite {
    id: Uuid::nil(),
    channel_id: Uuid::nil(),
    target_type: OverwriteTarget::Role,
    target_id: Uuid::nil(),
    allow: Permissions::VIEW_CHANNEL,
    deny: Permissions::empty(),
  };
  println!("{}", serde_json::to_string_pretty(&ow).unwrap());
}
