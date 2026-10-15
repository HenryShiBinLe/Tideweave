"""Exercise every level through real browser clicks; all temporary files stay here."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
from threading import Thread
from engine import LEVELS, Game, minimum_tree, chromatic_number
from test_rules import euler_solution
from game import create_server

ROOT = Path(__file__).resolve().parent

def solutions():
    result=[]
    for l in LEVELS:
        if l.kind=='euler': actions=[['node',n] for n in euler_solution(l)]
        elif l.kind=='route': actions=[['node',n] for n in (1,2,4,5)]
        elif l.kind=='dijkstra':
            g=Game(l);actions=[]
            while not g.state.finished:
                n=min((i for i in range(len(l.nodes)) if i not in g.state.confirmed),key=lambda i:g.state.distances[i])
                actions.append(['node',n]);g.node(n)
        elif l.kind=='mst': actions=[['edge',e] for e in sorted(minimum_tree(l)[1]-set(l.mandatory))]+[['submit',0]]
        elif l.kind=='color': actions=[['color',n,c] for n,c in chromatic_number(l)[1].items()]+[['submit',0]]
        else: actions=[['edge',5],['submit',0]]
        result.append(actions)
    return result

def run():
    with tempfile.TemporaryDirectory(dir=ROOT,prefix='.ui-test-') as tmp:
        tmp=Path(tmp)
        server=create_server(tmp/'progress.json')
        thread=Thread(target=server.serve_forever,daemon=True);thread.start()
        fixture=tmp/'solutions.json';fixture.write_text(json.dumps(solutions()),encoding='utf-8')
        try:
            env=dict(os.environ,GRAPH_URL=server.url,GRAPH_TEST_DIR=str(tmp),GRAPH_SOLUTIONS=str(fixture))
            subprocess.run(['node',str(ROOT/'verify_poster.cjs')],cwd=ROOT,env=env,check=True)
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':run()
