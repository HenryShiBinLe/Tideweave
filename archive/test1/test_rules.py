"""Independent solution checks and gameplay regressions. Run: python -m unittest -v test_rules"""
import itertools
import math
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from engine import LEVELS, Game, components, minimum_tree, shortest_distances, chromatic_number
from game import Progress

ROOT=Path(__file__).resolve().parent

def euler_solution(level):
    def walk(node,used,path):
        if len(used)==len(level.edges):return path
        for i,(a,b,_) in enumerate(level.edges):
            if i not in used and node in (a,b):
                nxt=b if a==node else a
                result=walk(nxt,used|{i},path+[nxt])
                if result:return result
    return walk(level.start,set(),[])

def floyd(level):
    size=len(level.nodes);d=[[math.inf]*size for _ in range(size)]
    for a in range(size):d[a][a]=0
    for a,b,w in level.edges:d[a][b]=d[b][a]=w
    for k in range(size):
        for a in range(size):
            for b in range(size):d[a][b]=min(d[a][b],d[a][k]+d[k][b])
    return d[level.start]

def solve(game):
    l=game.level
    if l.kind=='euler':
        for n in euler_solution(l):assert game.node(n)
    elif l.kind=='route':
        for n in (1,2,4,5):assert game.node(n)
    elif l.kind=='dijkstra':
        while not game.state.finished:
            n=min((i for i in range(len(l.nodes)) if i not in game.state.confirmed),key=lambda i:game.state.distances[i]);assert game.node(n)
    elif l.kind=='mst':
        _,edges=minimum_tree(l)
        for e in sorted(edges-set(l.mandatory)):assert game.edge(e)
        assert game.submit()
    elif l.kind=='color':
        _,colors=chromatic_number(l)
        for n,c in colors.items():assert game.node(n,c)
        assert game.submit()
    else:
        assert game.edge(5);assert game.submit()

class RulesTest(unittest.TestCase):
    def test_all_ten_have_three_star_solution(self):
        self.assertEqual(len(LEVELS),10)
        for level in LEVELS:
            with self.subTest(level=level.title):
                g=Game(level);solve(g);self.assertTrue(g.state.finished);self.assertEqual(g.state.stars,3)
    def test_euler_parity_and_start(self):
        for l in LEVELS[:2]:
            degrees=[sum(n in e[:2] for e in l.edges) for n in range(len(l.nodes))]
            odd=[n for n,d in enumerate(degrees) if d%2]
            self.assertIn(len(odd),(0,2));self.assertTrue(not odd or l.start in odd);self.assertIsNotNone(euler_solution(l))
    def test_euler_dead_end_and_undo(self):
        g=Game(LEVELS[1])
        for n in (4,5,6,7,4):self.assertTrue(g.node(n))
        self.assertFalse(g.state.finished);self.assertTrue(g.alert)
        self.assertFalse(g.node(7));self.assertTrue(g.undo());self.assertEqual(g.state.current,7)
    def test_route_counts_repeated_edges(self):
        g=Game(LEVELS[2])
        for n in (1,0,1,2,4,5):self.assertTrue(g.node(n))
        self.assertEqual(g.state.cost,13);self.assertEqual(g.state.stars,1)
    def test_distances_against_floyd(self):
        for l in LEVELS[2:5]:self.assertEqual(shortest_distances(l),floyd(l))
        self.assertEqual(floyd(LEVELS[2])[-1],9)
    def test_dijkstra_rejects_nonminimum_and_updates(self):
        g=Game(LEVELS[4]);g.node(0)
        self.assertEqual(g.state.distances[1],7);self.assertFalse(g.node(1));self.assertEqual(g.errors,1)
        g.node(2);self.assertEqual(g.state.distances[1],4)
        self.assertEqual(g.state.updates[0][1:3],(7,4))
        g.undo();self.assertEqual(g.state.distances[1],7);self.assertEqual(g.errors,1)
    def test_dijkstra_confirmed_is_immutable(self):
        g=Game(LEVELS[3]);g.node(0);self.assertFalse(g.node(0));self.assertEqual(len(g.history),1)
    def test_mst_against_exhaustive_trees(self):
        for l in LEVELS[5:7]:
            costs=[]
            for choice in itertools.combinations(range(len(l.edges)),len(l.nodes)-1):
                if set(l.mandatory)<=set(choice) and len(set(components(l,choice)))==1:costs.append(sum(l.edges[i][2] for i in choice))
            self.assertEqual(minimum_tree(l)[0],min(costs))
            if l.budget:self.assertLessEqual(min(costs),l.budget)
    def test_cycle_and_mandatory_and_budget(self):
        g=Game(LEVELS[6]);self.assertFalse(g.edge(0));self.assertEqual(g.state.cost,5)
        g.edge(1);self.assertFalse(g.edge(2));self.assertEqual(g.state.cost,7)
        g.edge(3);g.edge(7);self.assertEqual(g.state.cost,15)
        self.assertFalse(g.edge(6));self.assertEqual(g.state.cost,15)
        g.edge(7);self.assertEqual(g.state.cost,11)
    def test_colors_against_brute_force(self):
        for l in LEVELS[7:9]:
            for k in range(1,l.optimal_colors):
                self.assertFalse(any(all(c[a]!=c[b] for a,b,_ in l.edges) for c in itertools.product(range(k),repeat=len(l.nodes))))
            self.assertEqual(chromatic_number(l)[0],l.optimal_colors)
    def test_color_conflicts_require_correction(self):
        g=Game(LEVELS[7])
        for n in range(len(g.level.nodes)):g.node(n,0)
        self.assertEqual(len(g.conflicts()),5);self.assertFalse(g.submit());self.assertFalse(g.state.finished)
        _,colors=chromatic_number(g.level)
        for n,c in colors.items():g.node(n,c)
        self.assertTrue(g.submit());self.assertEqual(g.state.stars,3)
    def test_cut_has_exactly_one_bridge(self):
        l=LEVELS[9];bridges=[]
        for i in range(len(l.edges)):
            groups=components(l,set(range(len(l.edges)))-{i})
            if groups[0]!=groups[6]:bridges.append(i)
        self.assertEqual(bridges,[5])
        g=Game(l);g.edge(0);self.assertFalse(g.submit());g.edge(0);g.edge(5);self.assertTrue(g.submit());self.assertEqual(g.state.stars,3)
    def test_scores_never_overwrite_best_with_worse(self):
        with tempfile.TemporaryDirectory(dir=ROOT,prefix='.test-') as folder:
            p=Progress(Path(folder)/'save.json');p.stars[0]=3;self.assertTrue(p.save());q=Progress(p.path);self.assertEqual(q.stars[0],3)
            q.stars[0]=max(q.stars[0],1);q.save();self.assertEqual(Progress(p.path).stars[0],3)
    def test_corrupt_save_recovers(self):
        with tempfile.TemporaryDirectory(dir=ROOT,prefix='.test-') as folder:
            path=Path(folder)/'save.json'
            for text in ('not json','[]','{"stars":[9,-2,"x"],"last":100}'):
                path.write_text(text,encoding='utf-8');p=Progress(path);self.assertEqual(len(p.stars),10);self.assertEqual(p.last,0);self.assertTrue(all(0<=s<=3 for s in p.stars))
    def test_finished_rejects_extra_actions(self):
        for l in LEVELS:
            g=Game(l);solve(g);before=g.state.cost
            self.assertFalse(g.node(0));self.assertFalse(g.edge(0));self.assertFalse(g.submit());self.assertEqual(g.state.cost,before)
    def test_portable_save_location(self):
        with tempfile.TemporaryDirectory(dir=ROOT,prefix='.test-') as folder:
            executable=Path(folder)/'GraphLab.exe'
            with patch('persistence.sys.frozen',True,create=True),patch('persistence.sys.executable',str(executable)):
                p=Progress();self.assertEqual(p.path,Path(folder)/'data'/'progress.json')
                p.stars[0]=3;self.assertTrue(p.save());self.assertEqual(Progress().stars[0],3)

if __name__=='__main__':unittest.main(verbosity=2)
