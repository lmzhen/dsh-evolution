import sys
sys.path.insert(0, "D:/dsh/skill-merge/pipeline"); sys.path.insert(0, "D:/dsh/skill-merge/.pylibs")
import corpus
from config import Config
skills, _ = corpus.load_corpus(["D:/dsh/skill-merge/out/_tmp_bom_corpus"])
s = skills[0]
print("  Python: name=" + repr(s.name) + " desc=" + repr(s.description) + " bodyLen=" + str(len(s.body)) + " bodyHasCR=" + str("\r" in s.body))