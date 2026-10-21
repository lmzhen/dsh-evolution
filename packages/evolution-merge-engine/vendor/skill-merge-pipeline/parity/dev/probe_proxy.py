import os, time, urllib.request
os.environ["HTTPS_PROXY"] = "http://127.0.0.1:9"
os.environ["HTTP_PROXY"] = "http://127.0.0.1:9"
try:
    t0 = time.time()
    urllib.request.urlopen("https://api.siliconflow.cn/v1/models", timeout=8)
    print("  Python urllib: 请求成功（未走代理？）")
except Exception as e:
    print("  Python urllib: 失败 -> " + str(e)[:90] + " | " + ("%.1f" % (time.time() - t0)) + "s")