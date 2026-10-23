# Android 构建文件清理清单

盘点时间：2026-10-20

## 可清理

以下目录是 APK 构建过程中生成的中间文件，可在确认不需要保留增量构建状态后删除：

| 路径 | 约占用空间 | 清理影响 |
| --- | ---: | --- |
| `android/app/build/generated` | 719 MB | 下次构建会重新生成，其中包含打包用的游戏资源归档。 |
| `android/app/build/intermediates` | 1.7 GB | 下次构建会重新生成；后续首次构建会更慢。 |
| `android/app/build/tmp` | 56 KB | 临时编译文件，可重新生成。 |

合计约可释放 **2.4 GB**。这些目录当前尚未清理。

## 必须保留

| 路径 | 约占用空间 | 说明 |
| --- | ---: | --- |
| `android/app/build/outputs/apk/debug/app-debug.apk` | 767 MB | 本次生成的 APK；删除后需要重新打包才能恢复。 |

## 本次未列入清理

- `.cache/android/sdk`：约 2.6 GB，Android SDK 工具链；删除后需要重新准备 SDK。
- `.cache/android/gradle`：约 321 MB，Gradle 缓存；删除后会增加后续构建耗时。
- `.cache/android/nodejs-mobile-react-native-18.20.4.tgz`：约 100 MB，Android 构建依赖归档。
- `android/app/build/outputs/`：保留整个输出目录，避免误删 APK 及构建报告。

清理上述中间文件不会影响已经生成的 APK，但后续构建需要重新生成中间文件。项目游戏素材 `public/assets/` 不属于本清单，不应因 APK 清理而删除。
