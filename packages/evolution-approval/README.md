# @lmzhen/dsh-evolution-approval

审批是一个可选的人工闸门。打开后，可暂存的记忆/技能写入会停下来，等你用 `/evolution pending` 查看，再用 approve 或 reject 处理。

它只覆盖 memory/skill 工具写。整理器自己的归档/合并、合并器的提交都不经过这里。默认关闭；待批主要在有设置页的安装形态里看得到，通知和收件箱还不完整。

批准/拒绝是人做的决定。`release` 只回收执行中的孤儿，不是批准。
