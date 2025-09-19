use ::serde::Serialize;
use axum::Json;
use axum::extract::Query;
use std::collections::HashMap;
use utoipa::__dev::ComposeSchema;
use utoipa::openapi::path::{OperationBuilder, ParameterBuilder, ParameterIn};
use utoipa::openapi::schema::{RefBuilder, SchemaType};
use utoipa::openapi::{
    Content, Header, Object, RefOr, Required, Response, ResponsesBuilder, Schema, Type,
};
use utoipa::{PartialSchema as _, ToSchema};
use zelus::SUCCESS_DESCRIPTION;
use zelus::responses::DocumentedResultResponse;
use zelus::special::OptionalFromRequestParts;
use zelus::types::DocumentedType;

pub mod id;
mod serde;
mod server;

mod header {
    use http::HeaderName;

    pub(super) const TOTAL_PAGES: HeaderName = HeaderName::from_static("x-total-pages");
    pub(super) const TOTAL_RECORDS: HeaderName = HeaderName::from_static("x-total-count");
    pub(super) const PER_PAGE: HeaderName = HeaderName::from_static("x-per-page");
    pub(super) const PAGE: HeaderName = HeaderName::from_static("x-page");
}

#[derive(Copy, Clone)]
pub struct PageSplit {
    pub limit: u32,
    pub page: u32,

    // to be filled by apply_pagesplit
    total_pages: u32,
    total_records: u64,
}

pub struct Paged<T: Serialize> {
    limit: u32,
    page: u32,

    total_pages: u32,
    total_records: u64,

    data: Vec<T>,
}

impl<E> OptionalFromRequestParts<E> for PageSplit {
    async fn from_request_parts(parts: &mut http::request::Parts) -> Result<Option<Self>, E> {
        use ::serde::Deserialize;
        use axum::extract::FromRequestParts as _;
        #[derive(Debug, Deserialize)]
        struct PageSplitQuery {
            limit: Option<u32>,
            page: Option<u32>,
        }

        let query: Result<Query<PageSplitQuery>, _> =
            Query::<PageSplitQuery>::from_request_parts(parts, &()).await;
        Ok(match query {
            Ok(Query(PageSplitQuery {
                page: Some(page),
                limit,
            })) => Some(Self {
                page,
                limit: limit.unwrap_or(100),

                total_pages: 0,
                total_records: 0,
            }),
            _ => None,
        })
    }
}

impl DocumentedType for PageSplit {
    fn openapi(operations: OperationBuilder) -> OperationBuilder {
        operations
            .parameter(
                ParameterBuilder::new()
                    .parameter_in(ParameterIn::Query)
                    .name("page")
                    .description(Some(
                        "The page that should be returned. If missing disables paging.",
                    ))
                    .schema(Some(RefOr::T(Schema::Object(
                        Object::builder()
                            .schema_type(SchemaType::Type(Type::Integer))
                            .build(),
                    ))))
                    .required(Required::False),
            )
            .parameter(
                ParameterBuilder::new()
                    .parameter_in(ParameterIn::Query)
                    .name("limit")
                    .description(Some("Limits the items pro page."))
                    .schema(Some(RefOr::T(Schema::Object(
                        Object::builder()
                            .schema_type(SchemaType::Type(Type::Integer))
                            .build(),
                    ))))
                    .required(Required::False),
            )
    }
}

impl<T: Serialize> axum::response::IntoResponse for Paged<T> {
    fn into_response(self) -> axum::response::Response {
        let mut res = Json(self.data).into_response();

        res.headers_mut().insert(
            header::TOTAL_PAGES,
            http::HeaderValue::from(self.total_pages),
        );
        res.headers_mut().insert(
            header::TOTAL_RECORDS,
            http::HeaderValue::from(self.total_records),
        );
        res.headers_mut()
            .insert(header::PER_PAGE, http::HeaderValue::from(self.limit));
        res.headers_mut()
            .insert(header::PAGE, http::HeaderValue::from(self.page));
        res
    }
}

pub trait PageSplitExtension<T: Iterator<Item = E>, E> {
    fn apply_pagesplit(self, page: &mut Option<PageSplit>) -> T;

    fn collect_paged(self, page: Option<PageSplit>) -> Paged<E>
    where
        E: Serialize;
}

impl<'a, T: Iterator<Item = E> + 'a, E: 'a> PageSplitExtension<Box<dyn Iterator<Item = E> + 'a>, E>
    for T
{
    fn apply_pagesplit(self, page: &mut Option<PageSplit>) -> Box<dyn Iterator<Item = E> + 'a> {
        if let Some(page) = page {
            if page.limit == 0 {
                page.total_pages = 1;
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

    fn collect_paged(self, page: Option<PageSplit>) -> Paged<E>
    where
        E: Serialize,
    {
        match page {
            None => {
                let data: Vec<E> = self.collect();
                Paged {
                    page: 0,
                    limit: 0,
                    total_pages: 1,
                    total_records: data.len() as u64,
                    data,
                }
            }
            Some(split) => Paged {
                page: split.page,
                limit: split.limit,
                total_pages: split.total_pages,
                total_records: split.total_records,

                data: self.collect(),
            },
        }
    }
}

impl<E: Serialize + ComposeSchema + ToSchema> DocumentedResultResponse for Paged<E> {
    fn openapi(
        responses: ResponsesBuilder,
        schemas: &mut HashMap<String, RefOr<Schema>>,
    ) -> ResponsesBuilder {
        let mut vals = Vec::new();
        vals.push((<Vec<E>>::name().to_string(), <Vec<E>>::schema()));
        <Vec<E>>::schemas(&mut vals);
        schemas.extend(vals);
        responses.response(
            "200",
            Response::builder()
                .description(SUCCESS_DESCRIPTION)
                .content(
                    "application/json",
                    Content::new(Some(
                        RefBuilder::new().ref_location_from_schema_name(<Vec<E>>::name()),
                    )),
                )
                .header(
                    header::TOTAL_PAGES.as_str(),
                    Header::builder()
                        .description(Some("The total number of pages"))
                        .schema(RefOr::T(Schema::Object(
                            Object::builder()
                                .schema_type(SchemaType::Type(Type::Integer))
                                .build(),
                        )))
                        .build(),
                )
                .header(
                    header::TOTAL_RECORDS.as_str(),
                    Header::builder()
                        .description(Some("The total number of items"))
                        .schema(RefOr::T(Schema::Object(
                            Object::builder()
                                .schema_type(SchemaType::Type(Type::Integer))
                                .build(),
                        )))
                        .build(),
                )
                .header(
                    header::PER_PAGE.as_str(),
                    Header::builder()
                        .description(Some("The maximum number of items per page"))
                        .schema(RefOr::T(Schema::Object(
                            Object::builder()
                                .schema_type(SchemaType::Type(Type::Integer))
                                .build(),
                        )))
                        .build(),
                )
                .header(
                    header::PAGE.as_str(),
                    Header::builder()
                        .description(Some("The current page"))
                        .schema(RefOr::T(Schema::Object(
                            Object::builder()
                                .schema_type(SchemaType::Type(Type::Integer))
                                .build(),
                        )))
                        .build(),
                )
                .build(),
        )
    }
}
