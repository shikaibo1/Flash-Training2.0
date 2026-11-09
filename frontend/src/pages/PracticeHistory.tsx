import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, Clock, Calendar, Award, BarChart, Filter, HelpCircle, RefreshCw, Play, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { practiceApi } from '../lib/api';
import type { PracticeRecord } from '../types';
import { parseTimestamp } from '../lib/stats';

const PracticeHistory = () => {
  const [records, setRecords] = useState<PracticeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId] = useState<string>('default_user'); // 实际项目中应从认证系统获取
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  // 筛选条件
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterInputType, setFilterInputType] = useState<string>('all');
  
  // 获取练习记录
  const fetchPracticeRecords = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const result = await practiceApi.getRecords(userId);
      // 按时间倒序排序（优先使用 start_time，失败则使用 end_time），确保最新记录显示在上方
      const records = (result.records || []).slice().sort((a, b) => {
        const ta = parseTimestamp(a.start_time || a.end_time).getTime();
        const tb = parseTimestamp(b.start_time || b.end_time).getTime();
        return tb - ta;
      });
      setRecords(records);
    } catch (err) {
      setError('获取练习记录失败，请稍后重试');
      console.error('Error fetching practice records:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);
  
  // 格式化日期
  const formatDate = (isoString: string) => {
    const date = parseTimestamp(isoString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  
  // 计算练习时长
  const calculateDuration = (startTime: string, endTime: string) => {
    const start = parseTimestamp(startTime).getTime();
    const end = parseTimestamp(endTime).getTime();
    const duration = Math.floor((end - start) / 1000);
    if (!Number.isFinite(duration) || duration < 0) return '时间未记录';
    
    if (duration < 60) {
      return `${duration}秒`;
    } else {
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;
      return `${minutes}分${seconds}秒`;
    }
  };
  
  // 应用筛选
  const filteredRecords = records.filter(record => {
    const categoryMatch = filterCategory === 'all' || record.category === filterCategory;
    const inputTypeMatch = filterInputType === 'all' || record.input_type === filterInputType;
    return categoryMatch && inputTypeMatch;
  });
  
  // 获取唯一的分类列表
  const categories = ['all', ...Array.from(new Set(records.map(record => record.category)))];
  
  useEffect(() => {
    fetchPracticeRecords();

    // 监听跨页面事件（例如保存或删除后刷新）
    const onRecordSaved = () => fetchPracticeRecords();
    const onRecordDeleted = () => fetchPracticeRecords();
    window.addEventListener('practice:record-saved', onRecordSaved);
    window.addEventListener('practice:record-deleted', onRecordDeleted);

    return () => {
      window.removeEventListener('practice:record-saved', onRecordSaved);
      window.removeEventListener('practice:record-deleted', onRecordDeleted);
    };
  }, [fetchPracticeRecords]);
  
  return (
    <div className="max-w-4xl mx-auto space-y-8 p-4">
      {/* Header Navigation */}
      <div className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft size={20} />
          返回首页
        </Link>
        <div className="flex items-center gap-3">
          <button className="p-2 text-muted-foreground hover:bg-secondary rounded-lg" title="反馈问题">
            <Filter size={18} />
          </button>
        </div>
      </div>
      
      {/* Page Title */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-foreground mb-2">练习历史记录</h1>
        <p className="text-muted-foreground">查看你的所有练习记录和进步历程</p>
      </div>
      
      {/* Filters */}
      <div className="flex flex-wrap gap-4 justify-center">
        <div>
          <label className="text-sm font-medium text-foreground mr-2">分类:</label>
          <select 
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-3 py-1 border border-border rounded-lg bg-secondary/30"
          >
            {categories.map(category => (
              <option key={category} value={category}>
                {category === 'all' ? '全部' : category}
              </option>
            ))}
          </select>
        </div>
        
        <div>
          <label className="text-sm font-medium text-foreground mr-2">输入方式:</label>
          <select 
            value={filterInputType}
            onChange={(e) => setFilterInputType(e.target.value)}
            className="px-3 py-1 border border-border rounded-lg bg-secondary/30"
          >
            <option value="all">全部</option>
            <option value="voice">语音</option>
            <option value="text">文字</option>
          </select>
        </div>
      </div>
      
      {/* Records List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="relative w-20 h-20 mb-6">
              <div className="absolute inset-0 border-4 border-secondary rounded-full"></div>
              <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
              <BarChart className="absolute inset-0 m-auto text-primary" size={32} />
            </div>
            <h3 className="text-xl font-bold text-foreground">正在加载练习记录...</h3>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="text-red-500 mb-4">
              <HelpCircle size={48} />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">获取练习记录失败</h3>
            <p className="text-muted-foreground text-center mb-6">{error}</p>
            <button 
              onClick={fetchPracticeRecords}
              className="flex items-center gap-2 px-6 py-3 bg-primary text-white font-medium rounded-full hover:bg-primary/90 transition-colors"
            >
              <RefreshCw size={18} />
              重试
            </button>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="text-gray-400 mb-4">
              <Calendar size={48} />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">暂无练习记录</h3>
            <p className="text-muted-foreground text-center mb-6">开始你的第一次练习，记录将显示在这里</p>
            <Link 
              to="/"
              className="flex items-center gap-2 px-6 py-3 bg-primary text-white font-medium rounded-full hover:bg-primary/90 transition-colors"
            >
              <Play size={18} />
              开始练习
            </Link>
          </div>
        ) : (
          filteredRecords.map((record, index) => (
            <Link
              key={record.record_id || index}
              to={`/practice/${encodeURIComponent(record.skill_id)}${record.session_id ? `?session_id=${encodeURIComponent(record.session_id)}` : ''}`}
              state={{ fromHistory: true, record }}
              className="block no-underline text-inherit"
            >
              <div className="relative bg-card border border-border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow hover:scale-[1.01]">
                {/* 悬浮在卡片右上角的删除按钮 */}
                <div className="absolute top-2 right-2 z-20">
                  <button
                    aria-label="删除记录"
                    disabled={deletingId === record.record_id}
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!record.record_id) return;
                      if (!confirm('确定要删除这条记录吗？此操作不可撤销')) return;
                      try {
                        setDeletingId(record.record_id);
                        await practiceApi.deleteRecord(record.record_id);
                        // 本地移除
                        setRecords(prev => prev.filter(r => r.record_id !== record.record_id));
                        window.dispatchEvent(new CustomEvent('practice:record-deleted'));
                      } catch (err) {
                        console.error('删除失败', err);
                        alert('删除记录失败，请稍后重试');
                      } finally {
                        setDeletingId(null);
                      }
                    }}
                    className={`w-9 h-9 flex items-center justify-center rounded-full shadow-sm transition-colors ${deletingId === record.record_id ? 'bg-red-50 text-red-600 opacity-80' : 'bg-white/80 hover:bg-red-50 text-red-600'}`}
                    title="删除记录"
                  >
                    {deletingId === record.record_id ? (
                      <span className="text-xs font-medium">删除中</span>
                    ) : (
                      <Trash2 size={16} />
                    )}
                  </button>
                </div>

                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-foreground mb-1">{record.skill_name}</h3>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar size={14} />
                        {formatDate(record.start_time)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={14} />
                        {calculateDuration(record.start_time, record.end_time)}
                      </span>
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-secondary">
                        {record.input_type === 'voice' ? '语音输入' : '文字输入'}
                      </span>
                    </div>
                  </div>
                  <div className="text-right pr-12">
                    <div className="text-3xl font-bold text-primary">{record.score}</div>
                    <div className="text-xs text-muted-foreground">分数</div>
                  </div>
                </div>
                
                <div className="mb-4">
                  <h4 className="font-medium text-foreground mb-2">练习内容</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{record.transcript.substring(0, 100)}{record.transcript.length > 100 ? '...' : ''}</p>
                  {record.example_answer && (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded">
                      <h5 className="text-xs text-blue-800 font-medium">参考答案</h5>
                      <p className="text-sm text-blue-700 truncate">{record.example_answer}</p>
                    </div>
                  )}
                </div>
                
                <div className="flex justify-between items-center">
                  <div className="flex gap-3">
                    <div className="flex items-center gap-1 text-sm">
                      <span className="text-green-500">✓</span>
                      <span className="text-muted-foreground">{record.strengths?.length || 0}个优点</span>
                    </div>
                    <div className="flex items-center gap-1 text-sm">
                      <span className="text-yellow-500">→</span>
                      <span className="text-muted-foreground">{record.improvements?.length || 0}个改进点</span>
                    </div>
                  </div>
                  
                  <div className="text-xs text-muted-foreground">
                    难度: {record.difficulty} | 分类: {record.category}
                  </div>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
};

export default PracticeHistory;
