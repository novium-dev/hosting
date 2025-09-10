mod server;

use utoipa_axum::router::OpenApiRouter;

pub fn router() -> OpenApiRouter {
    OpenApiRouter::new().nest("/server", server::router())
}
