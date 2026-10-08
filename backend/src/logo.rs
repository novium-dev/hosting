use crate::config::{LogoUpload, S3Config};
use crate::db::project::ProjectId;
use core::time::Duration;
use rusty_s3::S3Action as _;

pub(crate) const LOGO_MAX_BYTES: usize = 2 * 1024 * 1024;

const KEY_PREFIX: &str = "project-logos";
const KEY_ID_LENGTH: usize = 21;
const SIGNATURE_LIFETIME: Duration = Duration::from_mins(1);
const CONTENT_TYPE: &str = "content-type";

#[derive(Debug, Clone, Copy)]
pub(crate) enum LogoFormat {
    Png,
    Jpeg,
    Gif,
    Webp,
}

impl LogoFormat {
    pub(crate) fn detect(bytes: &[u8]) -> Option<Self> {
        if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            Some(Self::Png)
        } else if bytes.starts_with(b"\xff\xd8\xff") {
            Some(Self::Jpeg)
        } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
            Some(Self::Gif)
        } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
            Some(Self::Webp)
        } else {
            None
        }
    }

    const fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Gif => "gif",
            Self::Webp => "webp",
        }
    }

    const fn content_type(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Gif => "image/gif",
            Self::Webp => "image/webp",
        }
    }
}

impl LogoUpload {
    pub(crate) async fn store(
        &self,
        client: &reqwest::Client,
        project_id: ProjectId,
        format: LogoFormat,
        content: Vec<u8>,
    ) -> Result<String, reqwest::Error> {
        match self {
            Self::S3(s3) => s3.store(client, project_id, format, content).await,
        }
    }

    pub(crate) async fn remove(
        &self,
        client: &reqwest::Client,
        project_id: ProjectId,
        url: &str,
    ) -> Result<(), reqwest::Error> {
        match self {
            Self::S3(s3) => s3.remove(client, project_id, url).await,
        }
    }
}

impl S3Config {
    fn public_base(&self) -> &str {
        self.public_url.as_str().trim_end_matches('/')
    }

    async fn store(
        &self,
        client: &reqwest::Client,
        project_id: ProjectId,
        format: LogoFormat,
        content: Vec<u8>,
    ) -> Result<String, reqwest::Error> {
        let key = format!(
            "{KEY_PREFIX}/{project_id}/{}.{}",
            nanoid::nanoid!(KEY_ID_LENGTH, &nanoid::alphabet::SAFE),
            format.extension()
        );

        let mut action = self.bucket.put_object(Some(&self.credentials), &key);
        action
            .headers_mut()
            .insert(CONTENT_TYPE, format.content_type());

        client
            .put(action.sign(SIGNATURE_LIFETIME))
            .header(CONTENT_TYPE, format.content_type())
            .body(content)
            .send()
            .await?
            .error_for_status()?;

        Ok(format!("{}/{key}", self.public_base()))
    }

    async fn remove(
        &self,
        client: &reqwest::Client,
        project_id: ProjectId,
        url: &str,
    ) -> Result<(), reqwest::Error> {
        let owned = format!("{}/", self.public_base());
        let Some(key) = url
            .strip_prefix(&owned)
            .filter(|key| key.starts_with(&format!("{KEY_PREFIX}/{project_id}/")))
        else {
            return Ok(());
        };

        client
            .delete(
                self.bucket
                    .delete_object(Some(&self.credentials), key)
                    .sign(SIGNATURE_LIFETIME),
            )
            .send()
            .await?
            .error_for_status()?;

        Ok(())
    }
}
