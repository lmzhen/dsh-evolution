import sys
sys.path.insert(0, "D:/dsh/skill-merge/pipeline"); sys.path.insert(0, "D:/dsh/skill-merge/.pylibs")
from stream_static import StreamedStatic
import numpy as np
m = StreamedStatic("D:/dsh/skill-merge/models/_tmp_int8_no_scales")
print("  Python: scales=" + str(m.scales) + " encode范数=" + str(round(float(np.linalg.norm(m.encode("测试"))), 4)))