"""GraphLab puzzle rules; independent of the user interface."""
from dataclasses import dataclass, field
from copy import deepcopy
from math import inf
import heapq

@dataclass(frozen=True)
class Level:
    title: str
    chapter: int
    kind: str
    difficulty: str
    goal: str
    instruction: str
    nodes: tuple
    edges: tuple
    hints: tuple
    start: int = 0
    target: int = -1
    mandatory: tuple = ()
    budget: int = 0
    optimal_colors: int = 0

def graph(names, positions, edges):
    return tuple((n,*p) for n,p in zip(names,positions)), tuple(tuple(e) if len(e)==3 else (*e,1) for e in edges)

CHAPTERS=(
 ('送信员','一笔走遍街区','欧拉路径','每条街走一次，路口可以重复经过。','除起点和终点外，进一次就要出一次。连通图中，奇数度节点有 0 个时可绕回起点；有 2 个时，它们就是两端。'),
 ('快递小哥','让时间变短','最短路 · Dijkstra','近的一条边，不一定通向最快的整条路。','Dijkstra 每次确认暂定距离最小的点，再更新邻居：新距离 = 当前距离 + 边权。更短就覆盖。它要求边权非负。'),
 ('修路大亨','连接，别浪费','最小生成树','连通所有村庄，需要 n − 1 条不成环的路。','Kruskal 按造价从低到高选边，跳过会成环的边。有必修路时，先连上它们，再连接不同的连通块。'),
 ('地图着色','相邻，就不同','图着色','标记代表颜色。只有直接相连的岛，才需要不同标记。','奇数个点围成环，至少要 3 种标记；两两相邻的 k 个点至少要 k 种。标记可以是形状或颜色，背后的约束相同。'),
 ('网络攻防','发现脆弱连接','桥 · 关键链路','删掉一条边就让整张网络断开，这条边叫桥。','环上的边有替代路线，不是桥。给桥的两侧加一条备用连接，就能消除这个单点故障。'),
)
g1=graph('ABCDE',((.50,.49),(.23,.16),(.16,.82),(.77,.16),(.84,.82)),((0,1),(1,2),(2,0),(0,3),(3,4),(4,0)))
g2=graph('ABCDEFGH',((.08,.48),(.24,.13),(.40,.48),(.24,.85),(.62,.48),(.78,.13),(.94,.48),(.78,.85)),((0,1),(1,2),(2,3),(3,0),(2,4),(4,5),(5,6),(6,7),(7,4)))
g3=graph(('仓库','北站','南站','花园','码头','客户'),((.08,.48),(.34,.14),(.34,.82),(.64,.14),(.64,.82),(.92,.48)),((0,1,2),(0,2,5),(1,3,8),(1,2,2),(2,4,3),(3,5,2),(4,5,2),(3,4,2)))
g4=graph('ABCDE',((.09,.48),(.35,.14),(.35,.82),(.65,.48),(.92,.48)),((0,1,2),(0,2,5),(1,3,4),(2,3,2),(3,4,2)))
g5=graph('ABCDEFG',((.07,.48),(.30,.13),(.30,.83),(.54,.13),(.54,.83),(.77,.48),(.95,.48)),((0,1,7),(0,2,2),(1,2,2),(1,3,3),(2,4,9),(3,4,1),(3,5,7),(4,5,2),(5,6,1)))
g6=graph('ABCDEF',((.10,.48),(.36,.14),(.66,.14),(.92,.48),(.66,.82),(.36,.82)),((0,1,3),(1,2,5),(2,3,4),(3,4,2),(4,5,6),(5,0,4),(1,5,1),(2,4,1)))
g7=graph('ABCDEFG',((.08,.48),(.32,.14),(.32,.82),(.58,.14),(.58,.82),(.83,.14),(.93,.82)),((0,1,5),(0,2,2),(1,2,1),(1,3,4),(2,4,3),(3,4,1),(3,5,2),(4,6,4),(5,6,2)))
g8=graph('ABCDE',((.50,.10),(.85,.37),(.73,.83),(.27,.83),(.15,.37)),((0,1),(1,2),(2,3),(3,4),(4,0)))
g9=graph('ABCDEF',((.26,.14),(.08,.83),(.52,.83),(.29,.53),(.80,.14),(.92,.83)),((0,1),(1,2),(2,0),(0,3),(1,3),(2,3),(0,4),(4,5),(5,2)))
g10=graph('ABCDEFGH',((.06,.48),(.23,.13),(.23,.83),(.42,.48),(.62,.48),(.80,.13),(.96,.48),(.80,.83)),((0,1),(1,3),(3,2),(2,0),(1,2),(3,4),(4,5),(5,6),(6,7),(7,4),(5,7)))
LEVELS=(
 Level('第一封信',0,'euler','初次出勤','每条街恰好走一次，送完街区的信。','邮差已在 A。点击相邻路口继续走。',*g1,('路口可以重复经过，街道不可以。','A 连着两个小环。先走完一个，再走另一个。')),
 Level('桥那边的灯',0,'euler','别急着过桥','从 C 出发，走遍所有街道；一次也不能重复。','点击相邻路口。走进死路？可以撤销。',*g2,('现在过桥，还能回到左侧送完信吗？','先绕完左边的环，再过 C—E。终点应该是 E。'),start=2),
 Level('九分钟快递',1,'route','小心近路','从仓库送到客户，争取 9 分钟内抵达。','点击相邻站点行进。数字是路程所需分钟。',*g3,('便宜的下一段，不等于便宜的全程。','试试经北站转南站。所有路段时间要累加。'),target=5),
 Level('导航实习生',1,'dijkstra','把距离算出来','从 A 出发，为所有站点确认最短距离。','每轮点击未确认节点中数字最小的一个。',*g4,('∞ 表示还没发现路线。先从数字为 0 的 A 开始。','确认后自动更新邻居。已经确认的点不再操作。')),
 Level('会变短的数字',1,'dijkstra','推翻第一印象','找出全部最短距离。已经显示的数字，还会变小。','每轮选未确认的最小值，观察旧距离被覆盖。',*g5,('A 到 B 初见是 7，经过 C 会不会更快？','同样的终点，如果新路线总和更小，就更新数字。')),
 Level('村庄通电',2,'mst','精打细算','连接全部六个村庄，用尽量少的造价。','点击道路修建；再次点击可拆除。不要成环。',*g6,('先找最便宜的道路，但同一片村庄之间别再绕出环。','先接上两条造价 1 的路，再连接不同的小片区。')),
 Level('旧桥必须留',2,'mst','预算挑战','保留旧桥，连通全部村庄；总造价不超过 16。','标着“旧桥”的路已建好，其余道路可拆改。',*g7,('旧桥连着的村庄已经属于同一片，不必再兜圈。','先选造价 1 的连接，再找造价 2 的连接。'),mandatory=(0,),budget=16),
 Level('五岛灯会',3,'color','两种够不够','桥两端用不同标记，种类越少越好。','先选标记，再点岛屿；可随时改。',*g8,('只有直接连桥的岛才算相邻。','五座岛绕一圈，两种标记交替会在最后相撞。试试第三种。'),optimal_colors=3),
 Level('中央岛的难题',3,'color','试出最少种类','相邻岛屿用不同标记，找到最少种类。','先处理彼此相连的 A、B、C、D。',*g9,('A、B、C、D 之间两两都有桥。','这四座岛必须四种不同标记。外围岛可以复用它们。'),optimal_colors=4),
 Level('最后一条备份',4,'cut','终局 · 链路审计','让西端 A 与东端 G 断联。切断次数越少越好。','点击链路剪断；再次点击可恢复。',*g10,('在环里剪一条边，数据可能从另一边绕过去。','两组服务器之间，哪条链路没有绕行路线？'),target=6),
)

def adjacent(level,node):
    for i,(a,b,w) in enumerate(level.edges):
        if a==node:yield i,b,w
        elif b==node:yield i,a,w

def shortest_distances(level):
    distances=[inf]*len(level.nodes);distances[level.start]=0;queue=[(0,level.start)]
    while queue:
        d,a=heapq.heappop(queue)
        if d!=distances[a]:continue
        for _,b,w in adjacent(level,a):
            if d+w<distances[b]:distances[b]=d+w;heapq.heappush(queue,(d+w,b))
    return distances

def components(level,selected):
    parent=list(range(len(level.nodes)))
    def find(x):
        while x!=parent[x]:parent[x]=parent[parent[x]];x=parent[x]
        return x
    for i in selected:
        a,b,_=level.edges[i];parent[find(a)]=find(b)
    return [find(i) for i in range(len(parent))]

def minimum_tree(level):
    chosen=set(level.mandatory)
    for i in sorted(range(len(level.edges)),key=lambda j:level.edges[j][2]):
        a,b,_=level.edges[i];groups=components(level,chosen)
        if groups[a]!=groups[b]:chosen.add(i)
    return sum(level.edges[i][2] for i in chosen),chosen

def chromatic_number(level):
    order=sorted(range(len(level.nodes)),key=lambda n:-sum(1 for _ in adjacent(level,n)))
    for k in range(1,len(level.nodes)+1):
        colors={}
        def visit(pos):
            if pos==len(order):return dict(colors)
            a=order[pos];blocked={colors[b] for _,b,_ in adjacent(level,a) if b in colors}
            for c in range(k):
                if c not in blocked:
                    colors[a]=c;result=visit(pos+1)
                    if result is not None:return result
                    del colors[a]
            return None
        result=visit(0)
        if result is not None:return k,result

@dataclass
class State:
    current:int
    path:list=field(default_factory=list)
    selected:set=field(default_factory=set)
    confirmed:set=field(default_factory=set)
    distances:list=field(default_factory=list)
    colors:dict=field(default_factory=dict)
    updates:list=field(default_factory=list)
    cost:int=0
    finished:bool=False
    stars:int=0

class Game:
    def __init__(self,level):
        self.level=level
        self.state=State(level.start,path=[level.start],selected=set(level.mandatory),distances=[0 if i==level.start else inf for i in range(len(level.nodes))],cost=sum(level.edges[i][2] for i in level.mandatory))
        self.history=[];self.message=level.instruction;self.alert=False;self.last_action=None;self.hint_count=0;self.errors=0
        self.optimum=(minimum_tree(level)[0] if level.kind=='mst' else shortest_distances(level)[level.target] if level.kind=='route' else level.optimal_colors if level.kind=='color' else 1)
    def save_step(self):self.history.append(deepcopy(self.state))
    def reject(self,message):self.message=message;self.alert=True;return False
    def undo(self):
        if not self.history:return self.reject('已经回到起点了。')
        self.state=self.history.pop();self.last_action=None;self.alert=False;self.message='已退回上一步。换个方向试试看。';return True
    def hint(self):
        self.message=self.level.hints[min(self.hint_count,len(self.level.hints)-1)];self.hint_count+=1;self.alert=False
    def node(self,n,color=0):
        l=self.level;s=self.state
        if s.finished or n not in range(len(l.nodes)):return False
        self.alert=False;self.last_action=None
        if l.kind in ('route','euler'):
            if n==s.current:return self.reject('点击相邻的下一个路口。')
            found=next(((i,w) for i,b,w in adjacent(l,s.current) if b==n),None)
            if found is None:return self.reject('这两个地点之间没有直接相连的路。')
            i,w=found
            if l.kind=='euler' and i in s.selected:return self.reject('这条街走过了，换一条黑色的路。')
            self.save_step();prev=s.current;s.current=n;s.path.append(n);s.selected.add(i);s.cost+=w;self.last_action=(prev,n)
            if l.kind=='euler':
                if len(s.selected)==len(l.edges):self.complete(3,'所有信件送达。每条街，恰好一次。')
                elif not any(j not in s.selected for j,_,_ in adjacent(l,n)):
                    self.message='走进死路了，还有街道没送到。撤销几步，换个顺序。';self.alert=True
                else:self.message=f'已走 {len(s.selected)} / {len(l.edges)} 条街 · 路口可以重复经过。'
            elif n==l.target:self.complete(3 if s.cost==self.optimum else 2 if s.cost<=self.optimum+3 else 1,f'抵达客户，用时 {s.cost} 分钟。最短路线是 {int(self.optimum)} 分钟。')
            else:self.message=f'用时 {s.cost} 分钟 · 从 {l.nodes[n][0]} 继续出发。'
            return True
        if l.kind=='dijkstra':
            if n in s.confirmed:return self.reject('这个站点已经确认。找还没有打勾的点。')
            minimum=min(d for j,d in enumerate(s.distances) if j not in s.confirmed)
            if s.distances[n]!=minimum or minimum==inf:
                self.errors+=1;return self.reject('先选未确认点中最小的数字。∞ 表示还没有发现路线。')
            self.save_step();s.confirmed.add(n);s.current=n;s.updates=[]
            for i,b,w in adjacent(l,n):
                if b not in s.confirmed and s.distances[n]+w<s.distances[b]:
                    candidate=s.distances[n]+w;s.updates.append((b,s.distances[b],candidate,i));s.distances[b]=candidate
            changes=[f'{l.nodes[b][0]}: {"∞" if old==inf else old} → {new}' for b,old,new,_ in s.updates]
            self.message=f'确认 {l.nodes[n][0]} = {s.distances[n]}。'+('  /  '.join(changes) if changes else '邻居已有更短路线，无需更新。')
            if len(s.confirmed)==len(l.nodes):self.complete(3 if self.errors==0 else 2 if self.errors<=2 else 1,f'全部最短距离确认。选点失误 {self.errors} 次。')
            return True
        if l.kind=='color':
            if color not in range(5) or s.colors.get(n)==color:return False
            self.save_step();s.colors[n]=color;conflict=self.conflicts();self.alert=bool(conflict)
            self.message='红色桥两端标记相同，换一个。' if conflict else f'已标记 {len(s.colors)} / {len(l.nodes)} 座岛。'
            return True
        return False
    def edge(self,i):
        l=self.level;s=self.state
        if s.finished or i not in range(len(l.edges)):return False
        self.alert=False;self.last_action=None
        if l.kind=='mst':
            if i in l.mandatory:return self.reject('这座旧桥必须保留，不能拆除。')
            a,b,w=l.edges[i]
            if i in s.selected:self.save_step();s.selected.remove(i);s.cost-=w;self.message='已拆除道路，造价已退还。';return True
            groups=components(l,s.selected)
            if groups[a]==groups[b]:return self.reject('两端已经连通，再修会绕成环。这笔钱省下来。')
            if l.budget and s.cost+w>l.budget:return self.reject('这条路会超出预算。先拆除其他路，再调整连接。')
            self.save_step();s.selected.add(i);s.cost+=w;remaining=len(set(components(l,s.selected)))
            self.message='全村已经连通。可以继续调整，或点击「验收」。' if remaining==1 else f'还剩 {remaining} 片村庄，继续连接它们。'
            return True
        if l.kind=='cut':
            self.save_step()
            if i in s.selected:s.selected.remove(i)
            else:s.selected.add(i)
            groups=components(l,set(range(len(l.edges)))-s.selected)
            self.message='两端已经断联。可以恢复多余的切口，或点击「验收」。' if groups[l.start]!=groups[l.target] else '两端仍能通信：数据绕了另一条路。'
            return True
        return False
    def conflicts(self):
        return {i for i,(a,b,_) in enumerate(self.level.edges) if a in self.state.colors and b in self.state.colors and self.state.colors[a]==self.state.colors[b]}
    def submit(self):
        l=self.level;s=self.state
        if s.finished:return False
        if l.kind=='mst':
            if len(set(components(l,s.selected)))!=1:return self.reject('还有村庄没连上，先把它们连接成一片。')
            if l.budget and s.cost>l.budget:return self.reject('造价超过预算。')
            self.save_step();self.complete(3 if s.cost==self.optimum else 2 if s.cost<=self.optimum+2 else 1,f'全村接通，造价 {s.cost}。本关最低造价 {self.optimum}。');return True
        if l.kind=='color':
            if len(s.colors)!=len(l.nodes):return self.reject('还有岛屿没有标记。')
            if self.conflicts():return self.reject('红色桥两端标记相同，请调整。')
            self.save_step();used=len(set(s.colors.values()));self.complete(max(1,3-(used-self.optimum)),f'用了 {used} 种标记，最少需要 {self.optimum} 种。');return True
        if l.kind=='cut':
            groups=components(l,set(range(len(l.edges)))-s.selected)
            if groups[l.start]==groups[l.target]:return self.reject('A 与 G 之间还有路线，请再观察网络。')
            self.save_step();self.complete(max(1,4-len(s.selected)),f'共切断 {len(s.selected)} 条链路。最佳方案只需切断 1 条。');return True
        return False
    def complete(self,stars,message):self.state.finished=True;self.state.stars=stars;self.message=message;self.alert=False
