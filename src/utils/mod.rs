pub mod id;
mod serde;

#[derive(Copy, Clone)]
pub struct PageSplit {
    pub limit: u32,
    pub page: u32,

    pub total_pages: u32,   // To be filled by method
    pub total_records: u64, // To be filled by method
}

impl<S: Send + Sync> axum::extract::OptionalFromRequestParts<S> for PageSplit {
    type Rejection = axum::extract::rejection::QueryRejection;

    async fn from_request_parts(
        parts: &mut http::request::Parts,
        state: &S,
    ) -> Result<Option<Self>, Self::Rejection> {
        use ::serde::Deserialize;
        use axum::extract::FromRequestParts as _;
        #[derive(Debug, Deserialize)]
        struct PageSplitQuery {
            limit: Option<u32>,
            page: Option<u32>,
        }

        let query: axum::extract::Query<PageSplitQuery> =
            axum::extract::Query::<PageSplitQuery>::from_request_parts(parts, state).await?;
        Ok(match query.0 {
            PageSplitQuery {
                page: Some(page),
                limit,
            } => Some(Self {
                page,
                limit: limit.unwrap_or(100),

                total_pages: 0,
                total_records: 0,
            }),
            _ => None,
        })
    }
}

impl axum::response::IntoResponseParts for PageSplit {
    type Error = ();

    fn into_response_parts(
        self,
        mut res: axum::response::ResponseParts,
    ) -> Result<axum::response::ResponseParts, Self::Error> {
        res.headers_mut().insert(
            http::HeaderName::from_static("X-Total-Pages"),
            http::HeaderValue::from(self.total_pages),
        );
        res.headers_mut().insert(
            http::HeaderName::from_static("X-Total-Count"),
            http::HeaderValue::from(self.total_records),
        );
        res.headers_mut().insert(
            http::HeaderName::from_static("X-Per-Page"),
            http::HeaderValue::from(self.limit),
        );
        res.headers_mut().insert(
            http::HeaderName::from_static("X-Page"),
            http::HeaderValue::from(self.page),
        );
        Ok(res)
    }
}

pub trait PageSplitExtension<T: Iterator<Item = E>, E> {
    fn apply_pagesplit(self, page: &mut Option<PageSplit>) -> T;
}

impl<'a, T: Iterator<Item = E> + 'a, E: 'a> PageSplitExtension<Box<dyn Iterator<Item = E> + 'a>, E>
    for T
{
    fn apply_pagesplit(self, page: &mut Option<PageSplit>) -> Box<dyn Iterator<Item = E> + 'a> {
        if let Some(page) = page {
            if page.limit == 0 {
                page.total_records = self.count() as u64;
                return Box::new(Vec::new().into_iter()); // Not allowed to devide by zero
            }
            let vec: Vec<_> = self.collect();

            let mut pages = vec.len() / page.limit as usize;
            if (vec.len() % page.limit as usize) > 0 {
                pages += 1;
            }
            page.total_pages = pages as u32;
            page.total_records = vec.len() as u64;

            Box::new(
                vec.into_iter()
                    .skip((page.page as usize) * (page.limit as usize))
                    .take(page.limit as usize),
            )
        } else {
            Box::new(self)
        }
    }
}
