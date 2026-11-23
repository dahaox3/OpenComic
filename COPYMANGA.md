# 本地漫画与拷贝漫画章末吐槽

[下载 Windows x64 便携版](https://github.com/dahaox3/OpenComic/releases/latest) · [在 Colab 打开 2× 批量超分笔记本](https://colab.research.google.com/github/dahaox3/OpenComic/blob/copymanga-comments/colab/OpenComic-2x.ipynb)

### 批量处理

1. 在 Colab 连接 NVIDIA GPU，运行 ① 准备环境。处理单话或已有 ZIP／CBZ 时运行 ②。
2. 处理一部作品的若干话时，跳到 ③，填入作品目录链接，运行后选择分组、起始话和结束话。确认显示的标题和话数，再运行 ④。
3. 下载整批 ZIP，解压得到作品文件夹。用 OpenComic 打开该文件夹或其中的 CBZ。在线章节的来源链接已保存在每个 CBZ 的 ZIP 注释里，改文件名也可以识别。
4. 每话成功后就会保存在当前 Colab 运行时。重跑同一范围会跳过相同超分设置下已完成的章节。可用 ⑤ 按文件名或章节 ID 单独下载。重置运行时前请取回成品。

### 阅读与旧文件绑定

读完最后一页再翻页即可看本章吐槽。卷轴模式向下滚动，评论在最后一张图下面。阅读工具栏的对话气泡可随时打开评论，看完点右上角的 × 返回漫画。下滑到评论底部会自动加载下一页，点「刷新」获取最新数据。离线时可以看已经打开过的评论页。

旧版笔记本产出的 CBZ、没有章节注释的 ZIP 和图片目录可以放成「作品文件夹／每话一个 CBZ 或子文件夹」。打开作品文件夹，点击工具栏的链接图标，粘贴拷贝漫画作品地址并绑定。也可从任意一话的吐槽面板点击「绑定整本作品」。遇到重名、番外或文件名无法识别时，点「校正章节」，按分组和章节标题选择。绑定和评论缓存保存在 OpenComic 的用户数据目录中。

评论和目录分别读取拷贝漫画的在线接口，只需要下载少量文本，打开漫画仍从本地文件读取图片。无评论、断网和加载失败会在评论区显示对应状态。

[OpenComic 上游](https://github.com/ollm/OpenComic) · [ComicReadScript 章节与评论接口参考](https://github.com/dahaox3/ComicReadScript/tree/chainner-upscale/src/userscript/copyApi)
