# Third-party notices

This plugin is derived in part from the ideas and behavior-scoring algorithm of:

- c1overzz/dsh-bili-scroll 0.1.19: https://github.com/c1overzz/dsh-bili-scroll
- holoiallo/dsh-bili-scroll 0.2.0: https://github.com/holoiallo/dsh-bili-scroll

The original MIT license is retained in LICENSE. No original transcription script is embedded. Audio transcription delegates to the configured Koishi sst service.

The original project vendors AGI_Ananas / bilibili-mcp. Its notice is preserved in resources/licenses/bilibili-mcp-LICENSE for attribution; this plugin does not ship that MCP server or depend on it at runtime.

Bilibili account authentication and site API operations are provided by @lumia.wang/koishi-plugin-adapter-bilibili (MIT), Lumia's independently maintained fork of koishi-plugin-adapter-bilibili-dm. ChatLuna provides the model and tool runtime; ChatLuna Agent provides scheduled execution. They are separate peer/runtime integrations, not copied into this package.

The @initencounter/sst package supplies the public speech-to-text service contract. Recognition providers, including koishi-plugin-doubao-asr, are configured separately and are not bundled into this plugin.

The optional yt-dlp-webui integration follows the HTTP API usage documented in koishi-plugin-ytpdl 1.0.1 (MIT). That plugin and the remote downloader are not bundled or executed by this plugin.
