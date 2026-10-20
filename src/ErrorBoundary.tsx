import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{children:ReactNode},{error:string}> {
  state={error:''};
  static getDerivedStateFromError(error:Error){return {error:error.message||'页面加载失败'}}
  componentDidCatch(error:Error,info:ErrorInfo){console.error('[Finwise UI Error]',{message:error.message,componentStack:info.componentStack})}
  render(){if(this.state.error)return <main className="fatal-error" role="alert"><div><h1>页面暂时无法显示</h1><p>{this.state.error}</p><button onClick={()=>{this.setState({error:''});location.reload()}}>重新加载</button></div></main>;return this.props.children}
}
